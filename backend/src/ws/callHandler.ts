/**
 * WebSocket call handler.
 *
 * Manages the full lifecycle of an emergency call WebSocket session:
 *  1. Receives call_start message → creates incident → opens Nova Sonic session
 *  2. Streams audio_chunk messages → forwards base64 PCM to Nova Sonic
 *  3. Nova Sonic callbacks → send audio responses / transcript updates back to browser
 *  4. Handles barge-in (__FLUSH__ sentinel from Nova Sonic)
 *  5. call_end or WS close → close Nova Sonic session → export transcript → update incident
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
} from "../types/index.ts";
import { createIncident, updateIncident } from "../services/incidentService.ts";
import { saveAgentTurn, saveCallerTurn, exportTranscript } from "../services/transcriptionService.ts";
import { uploadTranscript, uploadAudioChunk } from "../services/storageService.ts";
import { startNovaSession, type NovaSession, type AvailableUnitSummary } from "../agents/novaAgent.ts";

// ---------------------------------------------------------------------------
// Per-connection state
// ---------------------------------------------------------------------------

type CallState = {
  incident_id: string;
  session: NovaSession;
  callStartMs: number;
  audioFlushQueued: boolean;
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

  // Fetch nearby units from mock data to inject into agent's system prompt
  let available_units: AvailableUnitSummary[] = [];
  try {
    // Parse "lat, lng" from msg.location if present
    const coordParts = msg.location.split(",").map((s) => parseFloat(s.trim()));
    if (coordParts.length === 2 && !isNaN(coordParts[0]) && !isNaN(coordParts[1])) {
      const [lat, lng] = coordParts;
      const { getMockUnitsWithDistance } = await import("../routes/units.ts");
      const mockUnits = await getMockUnitsWithDistance(lat, lng);
      available_units = mockUnits.map((u) => ({
        unit_code: u.unit_code,
        type: u.type,
        status: u.status,
        zone: u.zone,
        distance_km: u.distance_km,
        eta_minutes: u.eta_minutes,
        crew_count: u.crew.length,
      }));
    }
  } catch {
    // non-fatal — proceed without unit context
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
            // Barge-in: signal caller to discard buffered audio
            // We send an empty audio_response to signal flush
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
        },

        onEnd(reason: string) {
          // Session ended — clean up
          finalizeCall(ws, incident_id, state).catch((err: unknown) => {
            console.error("[call] finalization failed:", err);
          });
          if (reason === "session_renewal") {
            // TODO: implement session renewal for calls >7m30s
            console.warn("[nova] session renewal needed for incident:", incident_id);
          }
        },

        onError(err: Error) {
          console.error("[nova] session error:", err.message);
          sendMsg(ws, { type: "error", message: `AI session error: ${err.message}` });
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

  state.current = { incident_id, session, callStartMs, audioFlushQueued: false };
}

async function handleCallEnd(
  ws: BunServerWebSocket,
  state: { current: CallState | null }
): Promise<void> {
  if (!state.current) return;
  const { incident_id, session } = state.current;
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
  state.current = null;
  await finalizeCallById(ws, incident_id);
}

async function finalizeCallById(
  ws: BunServerWebSocket,
  incident_id: string
): Promise<void> {
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
    // Still notify client the call ended
    sendMsg(ws, { type: "call_ended", incident_id });
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
