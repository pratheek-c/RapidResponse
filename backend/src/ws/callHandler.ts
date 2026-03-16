/**
 * WebSocket call handler.
 *
 * Manages the full lifecycle of an emergency call WebSocket session:
 *  1. Receives call_start message → creates incident → opens Nova Sonic session
 *  2. Streams audio_chunk messages → forwards base64 PCM to Nova Sonic
 *  3. Nova Sonic callbacks → send audio responses / transcript updates back to browser
 *  4. Handles barge-in (__FLUSH__ sentinel from Nova Sonic)
 *  5. call_end or WS close → close Nova Sonic session → export transcript → update incident
 *  6. Report Agent (Nova Lite) runs every 30s + on key events, sends report_update WS messages
 *  7. Dispatcher assigned from mock data by zone matching; surfaced in report
 *
 * Message protocol:
 *   Browser → Server: WsClientMessage (JSON)
 *   Server → Browser: WsServerMessage (JSON)
 *
 * This module exports handleWebSocket() for use in server.ts.
 */

import type {
  WsClientMessage,
  WsCallStartMessage,
  WsServerMessage,
  TranscriptionTurn,
} from "../types/index.ts";
import { createIncident, updateIncident } from "../services/incidentService.ts";
import { saveAgentTurn, saveCallerTurn, exportTranscript } from "../services/transcriptionService.ts";
import { uploadTranscript } from "../services/storageService.ts";
import {
  startNovaSession,
  registerSession,
  deregisterSession,
  type NovaSession,
  type AvailableUnitSummary,
} from "../agents/novaAgent.ts";
import { generateReport, assignDispatcher, type MockData } from "../agents/reportAgent.ts";
import { cacheReport, evictReport } from "../routes/reportRoute.ts";
import type { MockUnitWithDistance } from "../routes/units.ts";
import { maybeExtract, cancelExtraction, getExtraction } from "../services/extractionService.ts";
import { evaluateEscalation } from "../agents/triageAgent.ts";
import { pushSSE } from "../services/sseService.ts";
import { extractAnswer } from "../agents/dispatchBridgeAgent.ts";
import { dbGetDispatchQuestions, dbUpdateDispatchQuestion, getDb } from "../db/libsql.ts";

// ---------------------------------------------------------------------------
// Per-connection state
// ---------------------------------------------------------------------------

export type CallState = {
  incident_id: string;
  session: NovaSession;
  callStartMs: number;
  audioFlushQueued: boolean;
  // Report agent state
  transcript: TranscriptionTurn[];
  dispatchedUnits: MockUnitWithDistance[];
  assignedDispatcherId: string | null;
  mockData: MockData | null;
  callerLocation: string;
  callerAddress: string;
  reportIntervalId: ReturnType<typeof setInterval> | null;
  transcriptTurnsSinceLastReport: number;
  incidentType: import("../types/index.ts").IncidentType | null;
  incidentPriority: import("../types/index.ts").IncidentPriority | null;
  incidentStatus: import("../types/index.ts").IncidentStatus;
};

// ---------------------------------------------------------------------------
// WebSocket handler (Bun native server.ts ServerWebSocket API)
// ---------------------------------------------------------------------------

export type BunServerWebSocket = {
  send: (data: string | Buffer) => void | number;
  close: (code?: number, reason?: string) => void;
  data: unknown;
};

/**
 * Called when a new WebSocket connection is opened.
 * Returns initial state attached to the socket.
 */
export function onOpen(_ws: BunServerWebSocket): null {
  return null; // state is set after call_start
}

/**
 * Main message handler. Called for each message from the browser.
 */
export async function onMessage(
  ws: BunServerWebSocket,
  raw: string | Buffer,
  state: { current: CallState | null }
): Promise<void> {
  let msg: WsClientMessage;
  try {
    msg = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as WsClientMessage;
  } catch {
    sendMsg(ws, { type: "error", message: "Invalid JSON message" });
    return;
  }

  switch (msg.type) {
    case "call_start":
      await handleCallStart(ws, msg, state);
      break;

    case "audio_chunk":
      if (!state.current) {
        sendMsg(ws, { type: "error", message: "No active call session" });
        return;
      }
      await state.current.session.sendAudio(msg.data);
      break;

    case "call_end":
      await handleCallEnd(ws, state);
      break;

    default:
      sendMsg(ws, { type: "error", message: "Unknown message type" });
  }
}

/**
 * Called when the WebSocket connection closes.
 */
export async function onClose(
  _ws: BunServerWebSocket,
  state: { current: CallState | null }
): Promise<void> {
  if (state.current) {
    await handleCallEnd(_ws, state);
  }
}

// ---------------------------------------------------------------------------
// Call lifecycle
// ---------------------------------------------------------------------------

async function handleCallStart(
  ws: BunServerWebSocket,
  msg: WsCallStartMessage,
  state: { current: CallState | null }
): Promise<void> {
  if (state.current) {
    sendMsg(ws, { type: "error", message: "Call already in progress" });
    return;
  }

  let incident_id: string;
  try {
    const incident = await createIncident({
      caller_id: msg.caller_id,
      caller_location: msg.location,
      caller_address: msg.address ?? msg.location,
    });
    incident_id = incident.id;
  } catch (err) {
    sendMsg(ws, {
      type: "error",
      message: `Failed to create incident: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  // Acknowledge call accepted
  sendMsg(ws, { type: "call_accepted", incident_id });

  const callStartMs = Date.now();

  // Load mock data for report agent + dispatcher assignment
  let mockData: MockData | null = null;
  let available_units: AvailableUnitSummary[] = [];
  let mockUnitsWithDistance: MockUnitWithDistance[] = [];

  try {
    const coordParts = msg.location.split(",").map((s) => parseFloat(s.trim()));
    if (coordParts.length === 2 && !isNaN(coordParts[0]!) && !isNaN(coordParts[1]!)) {
      const lat = coordParts[0]!;
      const lng = coordParts[1]!;
      const { getMockUnitsWithDistance } = await import("../routes/units.ts");
      mockUnitsWithDistance = await getMockUnitsWithDistance(lat, lng);
      available_units = mockUnitsWithDistance.map((u) => ({
        unit_code: u.unit_code,
        type: u.type,
        status: u.status,
        zone: u.zone,
        distance_km: u.distance_km,
        eta_minutes: u.eta_minutes,
        crew_count: u.crew.length,
      }));
    }

    // Load full mock data for report agent
    const file = Bun.file(new URL("../../data/mock/dispatchers.json", import.meta.url));
    const raw = (await file.json()) as MockData;
    mockData = raw;
  } catch {
    // non-fatal — proceed without mock data
  }

  // Assign dispatcher from mock data
  let assignedDispatcherId: string | null = null;
  if (mockData) {
    const dispatcher = assignDispatcher(msg.location, mockData);
    assignedDispatcherId = dispatcher?.id ?? null;
  }

  // Open Nova Sonic session
  let session: NovaSession;
  try {
    session = await startNovaSession({
      incident_id,
      caller_location: msg.location,
      caller_address: msg.address ?? msg.location,
      protocol_context: "", // RAG context will be fetched dynamically via get_protocol tool
      available_units,
      callbacks: {
        onAudioOutput(base64Pcm: string) {
          if (base64Pcm === "__FLUSH__") {
            return;
          }
          sendMsg(ws, { type: "audio_response", data: base64Pcm });
        },

        onTranscript(role: "caller" | "agent", text: string) {
          const elapsed = Date.now() - callStartMs;

          // Save to DB (fire-and-forget — don't block audio pipeline)
          if (role === "agent") {
            saveAgentTurn(incident_id, text, elapsed).catch((err: unknown) => {
              console.error("[transcription] agent turn save failed:", err);
            });
          } else {
            saveCallerTurn(incident_id, text, elapsed).catch((err: unknown) => {
              console.error("[transcription] caller turn save failed:", err);
            });
          }
          sendMsg(ws, { type: "transcript_update", role, text });

          // Push transcript SSE to dispatcher dashboard
          pushSSE({
            type: "transcript_update",
            data: {
              incident_id,
              role: role === "agent" ? "ai" : "caller",
              text,
              timestamp: new Date().toISOString(),
            },
          });

          // Accumulate transcript in call state for report agent
          if (state.current) {
            state.current.transcript.push({
              id: crypto.randomUUID(),
              incident_id,
              role,
              text,
              timestamp_ms: elapsed,
              created_at: new Date().toISOString(),
            });
            state.current.transcriptTurnsSinceLastReport += 1;

            // Trigger 3-second debounced extraction after each AI turn
            if (role === "agent") {
              const simplifiedTranscript = state.current.transcript.map((t) => ({
                role: t.role,
                text: t.text,
              }));
              maybeExtract(incident_id, simplifiedTranscript);
            }

            // Trigger report after every 5 new transcript turns
            if (state.current.transcriptTurnsSinceLastReport >= 5) {
              state.current.transcriptTurnsSinceLastReport = 0;
              triggerReportUpdate(ws, state.current).catch((err: unknown) => {
                console.error("[report] transcript-triggered report failed:", err);
              });
            }

            // Evaluate escalation need after each caller turn
            if (role === "caller" && state.current.incidentPriority) {
              const extraction = getExtraction(incident_id);
              const suggestion = evaluateEscalation(
                state.current.transcript.map((t) => ({ role: t.role, text: t.text })),
                extraction,
                state.current.incidentPriority,
                [] // dispatched dept types — empty for now; full wiring needs unit type lookup
              );
              if (suggestion) {
                pushSSE({
                  type: "escalation_suggestion",
                  data: {
                    incident_id,
                    reason: suggestion.reason,
                    suggested_units: suggestion.suggested_units,
                  },
                });
              }
            }

            // After each caller turn, try to extract answers to any pending dispatch Q&A
            if (role === "caller") {
              void (async () => {
                try {
                  const db = getDb();
                  const questions = await dbGetDispatchQuestions(db, incident_id);
                  const unanswered = questions.filter((q) => q.answer === null);
                  console.log(`[callHandler] Caller turn finished. Pending dispatch Q&A count: ${unanswered.length}`);
                  if (unanswered.length === 0) return;

                  const simplifiedTranscript = state.current
                    ? state.current.transcript.map((t) => ({ role: t.role as "caller" | "agent", text: t.text }))
                    : [];

                  for (const q of unanswered) {
                    console.log(`[callHandler] Checking if transcript answers QA: "${q.question}"`);
                    const answer = await extractAnswer(q.question, simplifiedTranscript);
                    if (answer) {
                      console.log(`[callHandler] Found answer! "${answer}". Broadcasting SSE answer_update.`);
                      await dbUpdateDispatchQuestion(db, q.id, answer);
                      pushSSE({
                        type: "answer_update",
                        data: { incident_id, question: q.question, answer },
                      });
                      pushSSE({
                        type: "transcript_annotation",
                        data: { incident_id, icon: "✅", label: "Caller answered question", color: "green" },
                      });
                    } else {
                      console.log(`[callHandler] QA "${q.question}" still unanswered.`);
                    }
                  }
                } catch (err) {
                  console.error("[qa] answer extraction failed:", err instanceof Error ? err.message : String(err));
                }
              })();
            }
          }
        },

        onEnd(reason: string) {
          if (state.current) {
            clearReportInterval(state.current);
          }
          finalizeCall(ws, incident_id, state).catch((err: unknown) => {
            console.error("[call] finalization failed:", err);
          });
          if (reason === "session_renewal") {
            console.warn("[nova] session renewal needed for incident:", incident_id);
          }
        },

        onError(err: Error) {
          console.error("[nova] session error:", err.message);
          sendMsg(ws, { type: "error", message: `AI session error: ${err.message}` });
          if (state.current) {
            clearReportInterval(state.current);
          }
          finalizeCall(ws, incident_id, state).catch((e: unknown) => {
            console.error("[call] finalization after error failed:", e);
          });
        },
      },
    });
  } catch (err) {
    sendMsg(ws, {
      type: "error",
      message: `Failed to start AI session: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  // Register session for dispatcher injection
  registerSession(incident_id, session);

  state.current = {
    incident_id,
    session,
    callStartMs,
    audioFlushQueued: false,
    transcript: [],
    dispatchedUnits: [],
    assignedDispatcherId,
    mockData,
    callerLocation: msg.location,
    callerAddress: msg.address ?? msg.location,
    reportIntervalId: null,
    transcriptTurnsSinceLastReport: 0,
    incidentType: null,
    incidentPriority: null,
    incidentStatus: "active",
  };

  // Start 30-second report interval
  state.current.reportIntervalId = setInterval(() => {
    if (!state.current) return;
    triggerReportUpdate(ws, state.current).catch((err: unknown) => {
      console.error("[report] interval report failed:", err);
    });
  }, 30_000);

  // Fire initial report immediately (gives UI dispatcher card from first render)
  triggerReportUpdate(ws, state.current).catch((err: unknown) => {
    console.error("[report] initial report failed:", err);
  });
}

async function handleCallEnd(
  ws: BunServerWebSocket,
  state: { current: CallState | null }
): Promise<void> {
  if (!state.current) return;
  const { incident_id, session } = state.current;
  clearReportInterval(state.current);
  state.current = null;

  try {
    await session.close();
  } catch (err) {
    console.error("[nova] session close error:", err);
  }

  await finalizeCallById(ws, incident_id);
}

async function finalizeCall(
  ws: BunServerWebSocket,
  incident_id: string,
  state: { current: CallState | null }
): Promise<void> {
  if (state.current) {
    clearReportInterval(state.current);
  }
  state.current = null;
  await finalizeCallById(ws, incident_id);
}

async function finalizeCallById(
  ws: BunServerWebSocket,
  incident_id: string
): Promise<void> {
  // Remove from session registry + cancel any pending extraction
  deregisterSession(incident_id);
  cancelExtraction(incident_id);

  try {
    // Export transcript to S3
    const transcriptData = await exportTranscript(incident_id);
    const s3Key = await uploadTranscript(incident_id, transcriptData);

    // Update incident with transcript key
    await updateIncident(incident_id, {
      s3_transcript_key: s3Key,
    });

    sendMsg(ws, { type: "call_ended", incident_id });
  } catch (err) {
    console.error("[call] finalize error:", err);
    sendMsg(ws, { type: "call_ended", incident_id });
  }

  // Clean up cached report after a delay (allow HTTP polling to finish)
  setTimeout(() => evictReport(incident_id), 60_000);
}

// ---------------------------------------------------------------------------
// Report agent integration
// ---------------------------------------------------------------------------

async function triggerReportUpdate(
  ws: BunServerWebSocket,
  callState: CallState
): Promise<void> {
  if (!callState.mockData) return;

  try {
    const report = await generateReport({
      incident_id: callState.incident_id,
      caller_location: callState.callerLocation,
      caller_address: callState.callerAddress,
      incident_type: callState.incidentType,
      priority: callState.incidentPriority,
      status: callState.incidentStatus,
      call_start_ms: callState.callStartMs,
      transcript: callState.transcript,
      dispatched_units: callState.dispatchedUnits,
      assigned_dispatcher_id: callState.assignedDispatcherId,
      mock_data: callState.mockData,
    });

    // Cache report for HTTP polling
    cacheReport(report);

    // Push to browser
    sendMsg(ws, { type: "report_update", report });

    // If unit is approaching (ETA <= 3 min), send additional approaching message
    if (report.approaching_unit) {
      sendMsg(ws, {
        type: "dispatcher_approaching",
        unit_code: report.approaching_unit.unit_code,
        eta_minutes: report.approaching_unit.eta_minutes,
        crew: report.approaching_unit.crew,
      });
    }
  } catch (err) {
    console.error("[report] generateReport failed:", err instanceof Error ? err.message : String(err));
  }
}

function clearReportInterval(callState: CallState): void {
  if (callState.reportIntervalId !== null) {
    clearInterval(callState.reportIntervalId);
    callState.reportIntervalId = null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendMsg(ws: BunServerWebSocket, msg: WsServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // Socket closed — ignore
  }
}
