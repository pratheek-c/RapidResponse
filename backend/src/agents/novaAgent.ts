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
import { classifyIncident } from "../services/incidentService.ts";
import { dispatchUnit } from "../services/dispatchService.ts";
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

  return `You are a highly efficient, empathetic human agent handling a live 911 emergency call for ${env.DISPATCH_DEPT} in ${env.DISPATCH_CITY}. You are speaking to the caller over a real-time audio connection.

Current call context:
- Incident ID: ${incident_id}
${locationLine}
- Department: ${env.DISPATCH_DEPT}
${unitsBlock}

[PROTOCOL CONTEXT]
${protocol_context}
[END PROTOCOL CONTEXT]

Conversational rules you must strictly follow:

Extreme Brevity: Keep every response to 1 or 2 short sentences. Never give long monologues. Ask one question at a time and pause for the caller to respond.

No Formatting: You are generating speech. Never use bullet points, asterisks, numbering, emojis, or any markdown. Use only plain words and standard punctuation.

Natural Phrasing: Use conversational fillers naturally when appropriate, such as "Got it," "Okay," "Understood," or "Alright."

Numbers and Symbols: Spell out all symbols. Say "dollars" not "$". Read numbers conversationally, say "twenty-four hundred" not "2400".

Interruptions: The caller may interrupt you mid-sentence. If they do, immediately stop and address what they said. Never mention that you were interrupted. Seamlessly continue the conversation on the new topic.

Tone: Warm, calm, professional, and quick. Never robotic or overly formal. You are a real person helping someone in crisis.

Your job:
- Open with exactly: "911, what's your emergency?"
- Gather: nature of emergency, exact location, caller safety, injuries
- Use classify_incident once you know enough
- Use get_protocol when you need guidance on what to tell the caller
- Use dispatch_unit to send the right unit — pick the closest available one
- Keep the caller on the line and give short pre-arrival instructions based on protocol`;
}

// ---------------------------------------------------------------------------
// Nova Sonic session
// ---------------------------------------------------------------------------

export type NovaSession = {
  /** Send a base64-encoded PCM audio frame from the caller to Nova Sonic. */
  sendAudio: (base64Pcm: string) => Promise<void>;
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
  const audioContentName = crypto.randomUUID();  
  const systemPromptText = buildSystemPrompt(incident_id, caller_location, protocol_context, caller_address, available_units);

  async function* buildInputStream() {
    // 1. sessionStart
    yield encodeChunk("sessionStart", {
      inferenceConfiguration: {
        maxTokens: 1024,
        topP: 0.9,
        temperature: 0.7,
      },
      turnDetectionConfiguration: {
        endpointingSensitivity: "HIGH",
      },
    });

    // 2. promptStart
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
    yield encodeChunk("contentStart", {
      promptName,
      contentName: systemContentName,
      type: "TEXT",
      interactive: false,
      role: "SYSTEM",
      textInputConfiguration: { mediaType: "text/plain" },
    });

    // 4. textInput
    yield encodeChunk("textInput", {
      promptName,
      contentName: systemContentName,
      content: systemPromptText,
    });

    // 5. contentEnd
    yield encodeChunk("contentEnd", {
      promptName,
      contentName: systemContentName,
    });

    // 6. contentStart (AUDIO)
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
    {
      const PRIME_BYTES = 9600;
      const silence = new Uint8Array(PRIME_BYTES);
      let bin = "";
      for (let j = 0; j < silence.length; j++) bin += String.fromCharCode(silence[j]);
      eventQueue.push(encodeChunk("audioInput", {
        promptName,
        contentName: audioContentName,
        content: btoa(bin),
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
      const response = await client.send(command);

      if (
        !response.body ||
        typeof (response.body as unknown as AsyncIterable<unknown>)[Symbol.asyncIterator] !== "function"
      ) {
        throw new Error(
          `Nova Sonic response.body is not iterable — raw: ${JSON.stringify(response.body)}`
        );
      }

      for await (const event of response.body) {
        if (sessionClosed) break;
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
          audioContentName,
        });
      }

      callbacks.onEnd("stream_complete");
    } catch (err) {
      if (!sessionClosed) {
        const msg = err instanceof Error
          ? err.message
          : (typeof err === "object" ? JSON.stringify(err, Object.getOwnPropertyNames(err as object)) : String(err));
        console.error("[nova] stream error detail:", msg);
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
    audioContentName: string;
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

  // contentStart — start a new text accumulation block
  if (ev["contentStart"]) {
    const cs = ev["contentStart"] as Record<string, unknown>;
    const rawRole = (cs["role"] as string | undefined)?.toUpperCase();
    if (rawRole === "USER" || rawRole === "ASSISTANT") {
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

  if (ev["toolUse"]) {
    const tool = ev["toolUse"] as Record<string, unknown>;
    ctx.pendingToolUseId.set(tool["toolUseId"] as string);
    ctx.pendingToolName.set(tool["toolName"] as string);
    ctx.pendingToolInput.set("");
    return;
  }

  if (ev["toolInputDelta"]) {
    const delta = ev["toolInputDelta"] as Record<string, unknown>;
    ctx.pendingToolInput.set(
      ctx.pendingToolInput.get() + ((delta["delta"] as string) ?? "")
    );
    return;
  }

  if (ev["contentEnd"]) {
    const end = ev["contentEnd"] as Record<string, unknown>;
    const contentName = end["contentName"] as string | undefined;

    // Emit accumulated text block
    const block = ctx.currentTextBlock.get();
    if (block && block.text.trim()) {
      ctx.currentTextBlock.set(null);
      ctx.callbacks.onTranscript(block.role, block.text.trim());
    }

    if (end["stopReason"] === "TOOL_USE") {
      const toolUseId = ctx.pendingToolUseId.get();
      const toolName = ctx.pendingToolName.get();
      const toolInputStr = ctx.pendingToolInput.get();

      if (!toolUseId || !toolName) return;

      const toolResult = await executeTool(toolName, toolInputStr, ctx.incident_id);

      const resultContentName = crypto.randomUUID();

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

      ctx.pendingToolUseId.set(null);
      ctx.pendingToolName.set(null);
      ctx.pendingToolInput.set("");
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
