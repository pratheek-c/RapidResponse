/**
 * Nova Sonic bidirectional streaming agent.
 *
 * Manages a full AI voice call session with AWS Bedrock Nova Sonic 2:
 *  - Opens bidirectional HTTP/2 stream via InvokeModelWithBidirectionalStreamCommand
 *  - Sends audio frames as base64-encoded PCM 16-bit 16kHz mono (~32ms each)
 *  - Receives audio responses (24kHz mono) + text transcripts + tool calls
 *  - Handles tool calls: classify_incident, get_protocol, dispatch_unit
 *  - Implements barge-in (flush audio queue on "interrupted": true)
 *  - Implements session renewal at 7m30s (max session: 8 minutes)
 *
 * Audio format:
 *   Input:  PCM 16-bit, 16kHz, mono, base64-encoded ("audio/lpcm")
 *   Output: PCM 16-bit, 24kHz, mono, base64-encoded ("audio/lpcm")
 *
 * Node.js SDK (v3) Binary Format:
 *   The InvokeModelWithBidirectionalStreamCommand body must yield chunks of type:
 *   { chunk: { bytes: Uint8Array } }
 *   where bytes is the JSON.stringify of { event: { <eventType>: { ... } } }
 */

import {
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { NodeHttp2Handler } from "@smithy/node-http-handler";
import { env } from "../config/env.ts";
import { searchProtocols } from "../services/ragService.ts";
import { classifyIncident, flagCovertDistress } from "../services/incidentService.ts";
import { dispatchUnit } from "../services/dispatchService.ts";
import { pushSSE } from "../services/sseService.ts";
import { autoAssign } from "./triageAgent.ts";
import type {
  IncidentType,
  IncidentPriority,
  UnitType,
} from "../types/index.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NovaSessionCallbacks = {
  /** Called with each base64-encoded PCM 24kHz audio chunk to send to caller. */
  onAudioOutput: (base64Pcm: string) => void;
  /** Called with each transcribed text turn. */
  onTranscript: (role: "caller" | "agent", text: string) => void;
  /** Called when the session ends (normally or on error). */
  onEnd: (reason: string) => void;
  /** Called on unrecoverable errors. */
  onError: (err: Error) => void;
};

export type NovaSessionOptions = {
  incident_id: string;
  caller_location: string;
  caller_address?: string;
  protocol_context: string;
  available_units?: AvailableUnitSummary[];
  callbacks: NovaSessionCallbacks;
};

/** Compact unit summary injected into the Nova Sonic system prompt. */
export type AvailableUnitSummary = {
  unit_code: string;
  type: string;
  status: string;
  zone: string;
  distance_km: number;
  eta_minutes: number;
  crew_count: number;
};

// ---------------------------------------------------------------------------
// Active session registry
// ---------------------------------------------------------------------------

/**
 * Map of incident_id → active NovaSession.
 * Allows dispatch routes to inject text into an ongoing call.
 */
const activeSessions = new Map<string, NovaSession>();

export function registerSession(incident_id: string, session: NovaSession): void {
  activeSessions.set(incident_id, session);
}

export function deregisterSession(incident_id: string): void {
  activeSessions.delete(incident_id);
}

export function getActiveSession(incident_id: string): NovaSession | null {
  return activeSessions.get(incident_id) ?? null;
}

/**
 * Inject a dispatcher text message into an active Nova Sonic session.
 * The text is sent as a USER turn so Nova Sonic can relay it to the caller.
 * Returns true if the session was found and the injection queued.
 */
export async function injectTextIntoSession(
  incident_id: string,
  text: string
): Promise<boolean> {
  const session = activeSessions.get(incident_id);
  if (!session) return false;
  await session.injectText(text);
  return true;
}

// ---------------------------------------------------------------------------
// Tool schemas (sent in promptStart)
// ---------------------------------------------------------------------------

const TOOL_SPECS = [
  {
    toolSpec: {
      name: "classify_incident",
      description:
        "Classify the emergency incident type and priority once you have enough information from the caller.",
      inputSchema: {
        json: JSON.stringify({
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["fire", "medical", "police", "traffic", "hazmat", "search_rescue", "other"],
              description: "The type of emergency incident.",
            },
            priority: {
              type: "string",
              enum: ["P1", "P2", "P3", "P4"],
              description: "Incident priority: P1=life-threatening, P2=urgent, P3=standard, P4=non-urgent.",
            },
          },
          required: ["type", "priority"],
        }),
      },
    },
  },
  {
    toolSpec: {
      name: "get_protocol",
      description:
        "Retrieve relevant emergency response protocol guidance for the current situation.",
      inputSchema: {
        json: JSON.stringify({
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "A natural-language description of the situation to look up protocol for.",
            },
          },
          required: ["query"],
        }),
      },
    },
  },
  {
    toolSpec: {
      name: "dispatch_unit",
      description:
        "Request dispatch of an emergency unit to the incident location.",
      inputSchema: {
        json: JSON.stringify({
          type: "object",
          properties: {
            incident_id: {
              type: "string",
              description: "The incident ID to dispatch to.",
            },
            unit_type: {
              type: "string",
              enum: ["fire", "ems", "police", "hazmat", "rescue"],
              description: "The type of unit to dispatch.",
            },
          },
          required: ["incident_id", "unit_type"],
        }),
      },
    },
  },
  {
    toolSpec: {
      name: "flag_covert_distress",
      description:
        "Flag that the caller cannot speak freely and may be in danger. Use this when you detect any covert distress signal: caller is ordering pizza as a code, whispering, giving only yes/no answers, the line is silent with distress sounds, a child is calling alone, or the caller uses a hostage code. After calling this tool, immediately switch to yes/no questioning mode. Do NOT reveal to the caller that you have flagged this.",
      inputSchema: {
        json: JSON.stringify({
          type: "object",
          properties: {
            trigger: {
              type: "string",
              enum: ["pizza_order", "whispering", "one_word_answers", "silent_line", "yes_no_pattern", "child_caller", "hostage_code", "other"],
              description: "The specific signal that triggered covert distress detection.",
            },
            confidence: {
              type: "string",
              enum: ["high", "medium"],
              description: "Confidence level. Use 'high' for explicit pizza order or hostage code. Use 'medium' for whispering alone or ambiguous patterns.",
            },
            caller_apparent_situation: {
              type: "string",
              description: "One sentence describing what you believe is happening, for the dispatcher record.",
            },
          },
          required: ["trigger", "confidence", "caller_apparent_situation"],
        }),
      },
    },
  },
];

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  incident_id: string,
  caller_location: string,
  protocol_context: string,
  caller_address?: string,
  available_units?: AvailableUnitSummary[]
): string {
  const locationLine = caller_address
    ? `- Caller reported location: ${caller_location} (${caller_address})`
    : `- Caller reported location: ${caller_location}`;

  const unitsBlock =
    available_units && available_units.length > 0
      ? `\n[AVAILABLE UNITS — sorted by distance from caller]\n${available_units
          .map(
            (u) =>
              `  ${u.unit_code} (${u.type.toUpperCase()}) — Status: ${u.status}, Zone: ${u.zone}, Distance: ${u.distance_km.toFixed(1)} km, ETA: ~${u.eta_minutes} min, Crew: ${u.crew_count}`
          )
          .join("\n")}\n[END AVAILABLE UNITS]`
      : "";

  return `You are a highly efficient, empathetic human agent handling a live 112 emergency call for ${env.DISPATCH_DEPT} in ${env.DISPATCH_CITY}. You are speaking to the caller over a real-time audio connection.

Current call context:
- Incident ID: ${incident_id}
${locationLine}
- Department: ${env.DISPATCH_DEPT}
${unitsBlock}

[PROTOCOL CONTEXT]
${protocol_context}
[END PROTOCOL CONTEXT]

Conversational rules you must strictly follow:

Extreme Brevity: Every spoken response must be 1 to 3 short sentences maximum — no exceptions. Never give long monologues. Ask one question at a time. Your words go directly to a person in crisis; say only what helps them right now.

Spoken output rule: You speak ONLY to the caller. Never narrate what you are doing, what tools you are calling, what your reasoning is, what the priority is, or what the system is doing. If you are calling a tool, speak as if the tool does not exist. Example — caller says "I've been stabbed": correct response is "Help is on the way. Press both hands firmly on the wound and hold hard. Is the attacker still there?" Wrong response is anything that mentions classification, dispatch, priority, incident IDs, protocol steps, or your own thinking process.

No Formatting: You are generating speech. Never use bullet points, asterisks, numbering, emojis, or any markdown. Use only plain words and standard punctuation.

Natural Phrasing: Use conversational fillers naturally when appropriate, such as "Got it," "Okay," "Understood," or "Alright."

Numbers and Symbols: Spell out all symbols. Say "dollars" not "$". Read numbers conversationally, say "twenty-four hundred" not "2400".

Interruptions: The caller may interrupt you mid-sentence. If they do, immediately stop and address what they said. Never mention that you were interrupted. Seamlessly continue the conversation on the new topic.

Tone: Warm, calm, professional, and quick. Never robotic or overly formal. You are a real person helping someone in crisis.

Your job:
- Open with exactly: "112, what's your emergency?"
- Gather: nature of emergency, exact location, caller safety, injuries
- Call classify_incident silently once you know enough — never announce this to the caller, never say you are classifying, never mention the priority
- Call get_protocol silently when you need guidance — never read tool results aloud, only act on them
- Call dispatch_unit silently to send the right unit — never tell the caller you are dispatching, never name the unit, never say "I'm sending help now" before it is done — just say "Help is on the way" after the tool call succeeds
- Call flag_covert_distress silently when you detect covert distress — never announce it
- Keep the caller on the line and give short direct pre-arrival instructions

CRITICAL — Internal reasoning stays internal:
Never speak your reasoning, your classification decision, your priority assessment, your next steps, or the incident ID. Never say things like "this is a P1 medical emergency", "I need to dispatch EMS", "the incident ID is...", "let me check the protocol", "I should ask about...", or "I'm going to...". Think those things silently; never say them. Your spoken output is ONLY direct, calm, short instructions or questions to the caller.

Covert Distress Detection — Critical Protocol:

Some callers cannot speak freely because a threat is nearby. Watch for ALL of these signals:
- Caller pretending to order pizza, food, a taxi, or any routine service on a 112 line
- Caller whispering or speaking in an unusually low voice
- Caller giving only single-word or yes/no answers when more detail is expected
- Line is nearly silent but breathing or movement can be heard
- Young child calling alone about a serious adult emergency
- Caller using a phrase that sounds like a code or pre-arranged signal
- Caller's answers are stilted, unnatural, or clearly shaped for a listener nearby

If you detect ANY of these signals:
1. Immediately call flag_covert_distress — do not announce it to the caller
2. Say softly: "I understand. If you need help, just say yes."
3. Switch entirely to yes/no questions — one question at a time, short
4. Never say the words "police", "Garda", "emergency units", or "sirens" aloud
5. Never repeat sensitive information back loudly
6. Tell them: "Help is coming. They will be quiet."
7. If caller says yes to two contradictory questions, they are being coached — say: "I understand. Help is on the way. You don't need to say anything else."

Life-Threatening Injury — Immediate Response:
If the caller reports active bleeding, stabbing, shooting, or any serious wound: your FIRST spoken sentence must be a direct first-aid instruction, not a question, not a classification statement. Then dispatch silently.
- Stabbing or bleeding: "Help is on the way. Press both hands hard on the wound and don't lift them. Is the attacker still nearby?"
- Gunshot wound: "Help is coming. Keep pressure on the wound with anything you have — your hand, clothing. Are you in a safe spot?"
- Unconscious person: "Help is on the way. Is the person breathing? Lay them on their back if it's safe."
- Burns: "Help is coming. Move away from the heat source if you can. Are you still inside the building?"
Never lead with "this sounds serious" or any statement about severity. Never narrate the steps you are taking. Instruction first, one question second, tools called silently in the background.`;
}

// ---------------------------------------------------------------------------
// Nova Sonic session
// ---------------------------------------------------------------------------

export type NovaSession = {
  /** Send a base64-encoded PCM audio frame from the caller to Nova Sonic. */
  sendAudio: (base64Pcm: string) => Promise<void>;
  /** Inject a dispatcher text turn into the active session. */
  injectText: (text: string) => Promise<void>;
  /** End the session cleanly. */
  close: () => Promise<void>;
};

/**
 * Encode an event into the binary format required by the Node.js SDK command body.
 */
function encodeChunk(eventType: string, payload: Record<string, unknown>): { chunk: { bytes: Uint8Array } } {
  return {
    chunk: {
      bytes: new TextEncoder().encode(JSON.stringify({ event: { [eventType]: payload } })),
    },
  };
}

/**
 * Open a Nova Sonic bidirectional stream and return controls.
 * Uses NodeHttp2Handler — Nova Sonic requires HTTP/2.
 */
export async function startNovaSession(
  options: NovaSessionOptions
): Promise<NovaSession> {
  const { incident_id, caller_location, caller_address, protocol_context, available_units, callbacks } = options;

  const client = new BedrockRuntimeClient({
    region: env.AWS_REGION,
    ...(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
            ...(env.AWS_SESSION_TOKEN ? { sessionToken: env.AWS_SESSION_TOKEN } : {}),
          },
        }
      : {}),
    requestHandler: new NodeHttp2Handler({
      requestTimeout: 480000, // 8 minutes
      sessionTimeout: 480000,
    }),
  });

  // Event queue for bidirectional stream
  const eventQueue: unknown[] = [];
  let streamWriter: ((event: unknown) => Promise<void>) | null = null;
  let sessionClosed = false;

  const RENEWAL_MS = 7 * 60 * 1000 + 30 * 1000;
  const renewalTimer = setTimeout(() => {
    callbacks.onEnd("session_renewal");
  }, RENEWAL_MS);

  let pendingToolUseId: string | null = null;
  let pendingToolName: string | null = null;
  let pendingToolInput: string = "";

  // Accumulate text per content block to avoid emitting duplicates
  // Current text block being accumulated from response events
  // (response contentStart has no contentName, so we track the active block)
  let currentTextBlock: { role: "caller" | "agent"; text: string } | null = null;

  const promptName = crypto.randomUUID();
  const systemContentName = crypto.randomUUID();
  // mutable — updated by injectText when audio block is cycled
  let audioContentName = crypto.randomUUID();
  const systemPromptText = buildSystemPrompt(incident_id, caller_location, protocol_context, caller_address, available_units);
  console.log(`[nova] system prompt length=${systemPromptText.length} units=${available_units?.length ?? 0}`);

  async function* buildInputStream() {
    // 1. sessionStart
    console.log("[nova:stream] → sessionStart");
    yield encodeChunk("sessionStart", {
      inferenceConfiguration: {
        maxTokens: 1024,
        topP: 0.9,
        temperature: 0.7,
      },
    });

    // 2. promptStart — toolConfiguration wired so Nova Sonic can call classify_incident, get_protocol, dispatch_unit
    console.log("[nova:stream] → promptStart");
    yield encodeChunk("promptStart", {
      promptName,
      textOutputConfiguration: { mediaType: "text/plain" },
      audioOutputConfiguration: {
        mediaType: "audio/lpcm",
        sampleRateHertz: 24000,
        sampleSizeBits: 16,
        channelCount: 1,
        voiceId: "tiffany",
        encoding: "base64",
        audioType: "SPEECH",
      },
      toolConfiguration: {
        tools: TOOL_SPECS,
      },
    });

    // 3. contentStart (SYSTEM)
    console.log("[nova:stream] → contentStart SYSTEM");
    yield encodeChunk("contentStart", {
      promptName,
      contentName: systemContentName,
      type: "TEXT",
      interactive: false,
      role: "SYSTEM",
      textInputConfiguration: { mediaType: "text/plain" },
    });

    // 4. textInput
    console.log("[nova:stream] → textInput SYSTEM");
    yield encodeChunk("textInput", {
      promptName,
      contentName: systemContentName,
      content: systemPromptText,
    });

    // 5. contentEnd
    console.log("[nova:stream] → contentEnd SYSTEM");
    yield encodeChunk("contentEnd", {
      promptName,
      contentName: systemContentName,
    });

    // 6. contentStart (AUDIO)
    // Note: no separate text trigger — the silence prime below is sufficient to
    // trigger Nova Sonic's VAD and produce the opening greeting from the system prompt.
    // A text trigger causes a second response (double greeting).
    console.log("[nova:stream] → contentStart AUDIO");
    yield encodeChunk("contentStart", {
      promptName,
      contentName: audioContentName,
      type: "AUDIO",
      interactive: true,
      role: "USER",
      audioInputConfiguration: {
        mediaType: "audio/lpcm",
        sampleRateHertz: 16000,
        sampleSizeBits: 16,
        channelCount: 1,
        audioType: "SPEECH",
        encoding: "base64",
      },
    });

    streamWriter = async (event: unknown) => {
      eventQueue.push(event);
    };

    // Send 300ms of silence to prime the audio stream so Nova Sonic detects
    // turn start and produces the opening greeting from the system prompt.
    // 300ms @ 16kHz 16-bit mono = 9600 bytes
    console.log("[nova:stream] → audioInput silence prime");
    {
      const PRIME_BYTES = 9600;
      eventQueue.push(encodeChunk("audioInput", {
        promptName,
        contentName: audioContentName,
        content: Buffer.from(new Uint8Array(PRIME_BYTES)).toString("base64"),
      }));
    }

    while (!sessionClosed) {
      if (eventQueue.length > 0) {
        const event = eventQueue.shift();
        yield event;
      } else {
        await Bun.sleep(10);
      }
    }

    // 8. contentEnd
    yield encodeChunk("contentEnd", {
      promptName,
      contentName: audioContentName,
    });

    // 9. promptEnd
    yield encodeChunk("promptEnd", {
      promptName,
    });

    // 10. sessionEnd
    yield encodeChunk("sessionEnd", {});
  }

  const command = new InvokeModelWithBidirectionalStreamCommand({
    modelId: env.BEDROCK_NOVA_SONIC_MODEL_ID,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: buildInputStream() as any,
  });

  (async () => {
    try {
      console.log("[nova] calling client.send()...");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = await client.send(command).catch((sendErr: unknown) => {
        console.error("[nova] client.send() FAILED:", sendErr instanceof Error ? `${sendErr.name}: ${sendErr.message}` : JSON.stringify(sendErr, Object.getOwnPropertyNames(sendErr as object)));
        throw sendErr;
      });
      console.log("[nova] client.send() succeeded");

      if (!response.body || typeof response.body[Symbol.asyncIterator] !== "function") {
        throw new Error("Nova Sonic response.body is not iterable");
      }

      console.log("[nova] iterating response.body...");
      for await (const event of response.body) {
        if (sessionClosed) break;
        // Debug: log raw event keys to diagnose format issues
        try {
          const raw = event as Record<string, unknown>;
          const evKeys = Object.keys(("event" in raw ? raw["event"] : raw) as object);
          console.log("[nova] ev keys:", evKeys);
        } catch { /* ignore */ }
        await handleOutputEvent(event, {
          incident_id,
          callbacks,
          pendingToolUseId: { get: () => pendingToolUseId, set: (v) => { pendingToolUseId = v; } },
          pendingToolName:  { get: () => pendingToolName,  set: (v) => { pendingToolName = v; } },
          pendingToolInput: { get: () => pendingToolInput, set: (v) => { pendingToolInput = v; } },
          currentTextBlock: { get: () => currentTextBlock, set: (v) => { currentTextBlock = v; } },
          sendChunk: async (eventType: string, payload: Record<string, unknown>) => {
            if (streamWriter) await streamWriter(encodeChunk(eventType, payload));
          },
          promptName,
          audioContentName: { get: () => audioContentName, set: (v) => { audioContentName = v as `${string}-${string}-${string}-${string}-${string}`; } },
        });
      }

      callbacks.onEnd("stream_complete");
    } catch (err) {
      if (!sessionClosed) {
        // Log full error object for diagnosis
        if (err instanceof Error) {
          const errObj = err as unknown as Record<string, unknown>;
          console.error("[nova] stream error name:", err.name);
          console.error("[nova] stream error message:", err.message);
          if (errObj["$fault"]) console.error("[nova] stream error $fault:", errObj["$fault"]);
          if (errObj["$metadata"]) console.error("[nova] stream error $metadata:", JSON.stringify(errObj["$metadata"]));
          if (errObj["$response"]) console.error("[nova] stream error $response:", JSON.stringify(errObj["$response"]));
        } else {
          console.error("[nova] stream error (non-Error):", JSON.stringify(err, Object.getOwnPropertyNames(err as object)));
        }
        const msg = err instanceof Error
          ? `${err.name}: ${err.message}`
          : (typeof err === "object" ? JSON.stringify(err, Object.getOwnPropertyNames(err as object)) : String(err));
        callbacks.onError(new Error(msg));
      }
    } finally {
      clearTimeout(renewalTimer);
      sessionClosed = true;
    }
  })();

  return {
    async sendAudio(base64Pcm: string) {
      if (sessionClosed || !streamWriter) return;
      await streamWriter(
        encodeChunk("audioInput", {
          promptName,
          contentName: audioContentName,
          content: base64Pcm,
        })
      );
    },

    async injectText(text: string) {
      if (sessionClosed || !streamWriter) return;

      // Nova Sonic does not allow two interactive content blocks open simultaneously.
      // Close the current audio block, send text, then reopen a fresh audio block.
      const oldAudioName = audioContentName;
      const newAudioName = crypto.randomUUID();
      audioContentName = newAudioName; // update before any sendAudio calls can race

      // 1. Close current audio content
      await streamWriter(encodeChunk("contentEnd", {
        promptName,
        contentName: oldAudioName,
      }));

      // 2. Send dispatcher text as a new interactive USER turn
      const injectContentName = crypto.randomUUID();
      await streamWriter(encodeChunk("contentStart", {
        promptName,
        contentName: injectContentName,
        type: "TEXT",
        interactive: true,
        role: "USER",
        textInputConfiguration: { mediaType: "text/plain" },
      }));
      await streamWriter(encodeChunk("textInput", {
        promptName,
        contentName: injectContentName,
        content: text,
      }));
      await streamWriter(encodeChunk("contentEnd", {
        promptName,
        contentName: injectContentName,
      }));

      // 3. Reopen audio channel with new content name
      await streamWriter(encodeChunk("contentStart", {
        promptName,
        contentName: newAudioName,
        type: "AUDIO",
        interactive: true,
        role: "USER",
        audioInputConfiguration: {
          mediaType: "audio/lpcm",
          sampleRateHertz: 16000,
          sampleSizeBits: 16,
          channelCount: 1,
          audioType: "SPEECH",
          encoding: "base64",
        },
      }));

      // 4. Prime the new audio block with 100ms of silence
      await streamWriter(encodeChunk("audioInput", {
        promptName,
        contentName: newAudioName,
        content: Buffer.from(new Uint8Array(3200)).toString("base64"),
      }));
    },

    async close() {
      sessionClosed = true;
      clearTimeout(renewalTimer);
    },
  };
}

// ---------------------------------------------------------------------------
// Output event handler
// ---------------------------------------------------------------------------

type ToolRef = {
  get: () => string | null;
  set: (v: string | null) => void;
};

type ToolInputRef = {
  get: () => string;
  set: (v: string) => void;
};

async function handleOutputEvent(
  event: unknown,
  ctx: {
    incident_id: string;
    callbacks: NovaSessionCallbacks;
    pendingToolUseId: ToolRef;
    pendingToolName: ToolRef;
    pendingToolInput: ToolInputRef;
    currentTextBlock: { get: () => { role: "caller" | "agent"; text: string } | null; set: (v: { role: "caller" | "agent"; text: string } | null) => void };
    sendChunk: (eventType: string, payload: Record<string, unknown>) => Promise<void>;
    promptName: string;
    audioContentName: { get: () => string; set: (v: string) => void };
  }
): Promise<void> {
  let ev: Record<string, unknown>;

  if (
    event &&
    typeof event === "object" &&
    "chunk" in (event as Record<string, unknown>)
  ) {
    const chunk = (event as Record<string, unknown>)["chunk"] as Record<string, unknown>;
    const bytes = chunk["bytes"] as Uint8Array | undefined;
    if (!bytes) return;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
      ev = ("event" in parsed ? parsed["event"] : parsed) as Record<string, unknown>;
    } catch {
      return;
    }
  } else {
    const raw = event as Record<string, unknown>;
    ev = ("event" in raw ? raw["event"] : raw) as Record<string, unknown>;
  }

  if (ev["audioOutput"]) {
    const audio = ev["audioOutput"] as Record<string, unknown>;
    if (audio["interrupted"] === true) {
      ctx.callbacks.onAudioOutput("__FLUSH__");
      return;
    }
    ctx.callbacks.onAudioOutput(audio["content"] as string);
    return;
  }

  // contentStart — start a new text accumulation block.
  // Skip ASSISTANT AUDIO-type blocks: Nova Sonic sends both a TEXT block (transcript)
  // and an AUDIO block (speech audio) per response. Both contain textOutput events,
  // which would cause the agent turn to appear twice in the transcript.
  if (ev["contentStart"]) {
    const cs = ev["contentStart"] as Record<string, unknown>;
    const rawRole = (cs["role"] as string | undefined)?.toUpperCase();
    const rawType = (cs["type"] as string | undefined)?.toUpperCase();
    if ((rawRole === "USER" || rawRole === "ASSISTANT") && rawType !== "AUDIO") {
      const role: "caller" | "agent" = rawRole === "USER" ? "caller" : "agent";
      ctx.currentTextBlock.set({ role, text: "" });
    }
    return;
  }

  // textOutput — accumulate into the active block
  if (ev["textOutput"]) {
    const text = ev["textOutput"] as Record<string, unknown>;
    const content = (text["content"] as string) ?? "";
    const block = ctx.currentTextBlock.get();
    if (block && content) {
      block.text += content;
    }
    return;
  }

  // Debug: figure out exactly what event key Bedrock is sending
  const keys = Object.keys(ev);
  if (!keys.includes("audioOutput") && !keys.includes("contentStart") && !keys.includes("contentEnd") && !keys.includes("textOutput")) {
    console.log(`[nova:event] Received Unhandled/Rare Event:`, JSON.stringify(ev).slice(0, 200));
  }

  if (ev["toolUse"]) {
    const tool = ev["toolUse"] as Record<string, unknown>;
    console.log(`[nova:event] toolUse payload:`, JSON.stringify(tool));
    ctx.pendingToolUseId.set(tool["toolUseId"] as string);
    ctx.pendingToolName.set(tool["toolName"] as string);
    // The input is bundled directly inside `toolUse.content` (as a string) or `toolUse.input` (as object or string)
    const rawInput = tool["content"] ?? tool["input"] ?? "";
    const inputStr = typeof rawInput === "string" ? rawInput : JSON.stringify(rawInput);
    ctx.pendingToolInput.set(inputStr);
    return;
  }

  // Handle both toolInputDelta and toolUseInput (depending on the SDK version)
  const deltaKey = ev["toolInputDelta"] ? "toolInputDelta" : (ev["toolUseInput"] ? "toolUseInput" : null);
  if (deltaKey) {
    const delta = ev[deltaKey] as Record<string, unknown>;
    console.log(`[nova:event] ${deltaKey} payload:`, JSON.stringify(delta));
    ctx.pendingToolInput.set(
      ctx.pendingToolInput.get() + ((delta["delta"] as string) ?? "")
    );
    return;
  }

  if (ev["contentEnd"]) {
    const end = ev["contentEnd"] as Record<string, unknown>;

    if (end["stopReason"] === "TOOL_USE") {
      // Clear pre-tool TEXT block without emitting — Nova Sonic will re-emit
      // a complete response after the tool result, so emitting here causes duplicates.
      ctx.currentTextBlock.set(null);
      const toolUseId = ctx.pendingToolUseId.get();
      const toolName = ctx.pendingToolName.get();
      const toolInputStr = ctx.pendingToolInput.get();

      if (!toolUseId || !toolName) return;

      console.log(`[nova:tool] Executing tool '${toolName}' with input: ${toolInputStr}`);
      const toolResult = await executeTool(toolName, toolInputStr, ctx.incident_id);
      console.log(`[nova:tool] Execution result:`, toolResult);

      // Must close the open AUDIO content block before sending the TOOL result.
      // Nova Sonic rejects concurrent interactive content blocks — same issue
      // as injectText. Pattern: close audio → send tool result → reopen audio.
      const oldAudioName = ctx.audioContentName.get();
      const newAudioName = crypto.randomUUID();
      ctx.audioContentName.set(newAudioName);

      // 1. Close current AUDIO block
      console.log(`[nova:tool] Closing AUDIO block ${oldAudioName}`);
      await ctx.sendChunk("contentEnd", {
        promptName: ctx.promptName,
        contentName: oldAudioName,
      });

      // 2. Send TOOL result content block
      const resultContentName = crypto.randomUUID();
      console.log(`[nova:tool] Sending TOOL result with name ${resultContentName}`);
      await ctx.sendChunk("contentStart", {
        promptName: ctx.promptName,
        contentName: resultContentName,
        interactive: false,
        role: "TOOL",
        toolResultConfiguration: {
          toolUseId,
          toolStatus: toolResult.success ? "SUCCESS" : "ERROR",
        },
      });
      await ctx.sendChunk("toolResultInput", {
        promptName: ctx.promptName,
        contentName: resultContentName,
        content: JSON.stringify(toolResult.data),
      });
      await ctx.sendChunk("contentEnd", {
        promptName: ctx.promptName,
        contentName: resultContentName,
      });

      // 3. Reopen AUDIO block with new content name
      console.log(`[nova:tool] Reopening AUDIO block ${newAudioName}`);
      await ctx.sendChunk("contentStart", {
        promptName: ctx.promptName,
        contentName: newAudioName,
        type: "AUDIO",
        interactive: true,
        role: "USER",
        audioInputConfiguration: {
          mediaType: "audio/lpcm",
          sampleRateHertz: 16000,
          sampleSizeBits: 16,
          channelCount: 1,
          audioType: "SPEECH",
          encoding: "base64",
        },
      });
      // Prime new audio block with 100ms silence
      await ctx.sendChunk("audioInput", {
        promptName: ctx.promptName,
        contentName: newAudioName,
        content: Buffer.from(new Uint8Array(3200)).toString("base64"),
      });

      ctx.pendingToolUseId.set(null);
      ctx.pendingToolName.set(null);
      ctx.pendingToolInput.set("");
    } else {
      // Normal content end — emit accumulated text block as transcript
      const block = ctx.currentTextBlock.get();
      if (block && block.text.trim()) {
        ctx.currentTextBlock.set(null);
        ctx.callbacks.onTranscript(block.role, block.text.trim());
      }
    }
    return;
  }
}

async function executeTool(
  toolName: string,
  inputJson: string,
  incident_id: string
): Promise<{ success: boolean; data: unknown }> {
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(inputJson) as Record<string, unknown>;
  } catch {
    return { success: false, data: { error: "Invalid tool input JSON" } };
  }

  try {
    switch (toolName) {
      case "classify_incident": {
        const type = input["type"] as IncidentType;
        const priority = input["priority"] as IncidentPriority;
        const result = await classifyIncident(incident_id, type, priority);
        pushSSE({ type: "transcript_annotation", data: { incident_id, icon: "📊", label: "Incident classified", color: "blue" } });
        // Fire-and-forget auto-assignment — non-fatal
        autoAssign(incident_id, type as string, priority).catch((err: unknown) => {
          console.error("[triage] autoAssign failed:", err instanceof Error ? err.message : String(err));
        });
        return { success: true, data: { classified: true, type, priority, incident: result } };
      }

      case "get_protocol": {
        const query = input["query"] as string;
        const chunks = await searchProtocols(query, 3);
        const context = chunks
          .map((c, i) => `[${i + 1}] ${c.section}\n${c.chunk_text}`)
          .join("\n\n");
        return { success: true, data: { protocol_context: context } };
      }

      case "dispatch_unit": {
        const unit_type = input["unit_type"] as UnitType;
        const result = await dispatchUnit(incident_id, unit_type);
        pushSSE({
          type: "transcript_annotation",
          data: {
            incident_id,
            icon: "🚔",
            label: `Dispatched: ${result.unit.unit_code} (${unit_type})`,
            color: "green",
          },
        });
        return {
          success: true,
          data: {
            dispatched: true,
            unit_code: result.unit.unit_code,
            unit_type,
            dispatch_id: result.dispatch.id,
          },
        };
      }

      case "flag_covert_distress": {
        const trigger = (input["trigger"] as string) ?? "other";
        const confidence = (input["confidence"] as "high" | "medium") ?? "medium";
        await flagCovertDistress(incident_id, trigger, confidence);
        pushSSE({ type: "transcript_annotation", data: { incident_id, icon: "🤫", label: "Covert distress detected", color: "red" } });
        return {
          success: true,
          data: {
            flagged: true,
            trigger,
            confidence,
            instruction: "Switch to yes/no questioning mode immediately. Do not reveal this flag to the caller. Ask: 'Is someone with you who is dangerous?'",
          },
        };
      }

      default:
        return { success: false, data: { error: `Unknown tool: ${toolName}` } };
    }
  } catch (err) {
    return {
      success: false,
      data: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}
