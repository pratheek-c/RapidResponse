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
 * Tool result timing:
 *   Send tool result on contentEnd with stopReason: "TOOL_USE" —
 *   NOT on the toolUse event itself.
 *
 * Event naming:
 *   Every event carries promptName UUID.
 *   Content blocks carry their own contentName UUID.
 */

import {
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand,
  type InvokeModelWithBidirectionalStreamInput,
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
  protocol_context: string; // RAG-retrieved protocol text, injected into system prompt
  callbacks: NovaSessionCallbacks;
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
  protocol_context: string
): string {
  return `You are an AI-powered 911 emergency dispatcher for ${env.DISPATCH_DEPT} in ${env.DISPATCH_CITY}.

Your role is to:
1. Calmly and professionally handle emergency calls
2. Gather essential information: nature of emergency, exact location, caller safety
3. Classify the incident type and priority using the classify_incident tool
4. Look up relevant response protocols using the get_protocol tool when needed
5. Request dispatch of appropriate units using the dispatch_unit tool
6. Keep the caller calm and provide pre-arrival instructions based on protocol guidance

Current call context:
- Incident ID: ${incident_id}
- Caller reported location: ${caller_location}
- City/Department: ${env.DISPATCH_CITY} / ${env.DISPATCH_DEPT}

[PROTOCOL CONTEXT]
${protocol_context}
[END PROTOCOL CONTEXT]

Guidelines:
- Always start by saying "911, what is your emergency?"
- Confirm the location early in the call
- Ask about injuries and immediate dangers
- Stay on the line with the caller
- Use plain, clear language — no jargon
- If the caller is in immediate danger, prioritize safety over information gathering`;
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
 * Open a Nova Sonic bidirectional stream and return controls.
 * Uses NodeHttp2Handler — Nova Sonic requires HTTP/2.
 */
export async function startNovaSession(
  options: NovaSessionOptions
): Promise<NovaSession> {
  const { incident_id, caller_location, protocol_context, callbacks } = options;

  const client = new BedrockRuntimeClient({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
    requestHandler: new NodeHttp2Handler({
      requestTimeout: 480000, // 8 minutes
      sessionTimeout: 480000,
    }),
  });

  // Event queue for bidirectional stream
  const eventQueue: unknown[] = [];
  let streamWriter: ((event: unknown) => Promise<void>) | null = null;
  let sessionClosed = false;

  // Session renewal timer — renew at 7m30s
  const RENEWAL_MS = 7 * 60 * 1000 + 30 * 1000;
  const renewalTimer = setTimeout(() => {
    callbacks.onEnd("session_renewal");
  }, RENEWAL_MS);

  // Tool result state — accumulated until contentEnd with TOOL_USE
  let pendingToolUseId: string | null = null;
  let pendingToolName: string | null = null;
  let pendingToolInput: string = "";

  const promptName = crypto.randomUUID();
  const systemPrompt = buildSystemPrompt(incident_id, caller_location, protocol_context);

  // Build the async iterable for the bidirectional stream input
  async function* buildInputStream() {
    // 1. sessionStart
    yield {
      sessionStart: {
        inferenceConfiguration: {
          maxTokens: 1024,
          topP: 0.9,
          temperature: 0.7,
        },
      },
    };

    // 2. promptStart with system prompt + tool specs
    yield {
      promptStart: {
        promptName,
        textOutputConfiguration: { mediaType: "text/plain" },
        audioOutputConfiguration: {
          mediaType: "audio/lpcm",
          sampleRateHertz: 24000,
          sampleSizeBits: 16,
          channelCount: 1,
          voiceId: "tiffany",
          encoding: "base64",
        },
        audioInputConfiguration: {
          mediaType: "audio/lpcm",
          sampleRateHertz: 16000,
          sampleSizeBits: 16,
          channelCount: 1,
          encoding: "base64",
        },
        systemPrompt: {
          text: systemPrompt,
        },
        toolConfiguration: {
          tools: TOOL_SPECS,
        },
      },
    };

    // 3. contentBlockStart for audio input
    const audioContentName = crypto.randomUUID();
    yield {
      contentBlockStart: {
        promptName,
        contentName: audioContentName,
        type: "AUDIO",
      },
    };

    // 4. Stream caller audio frames from the queue
    streamWriter = async (event: unknown) => {
      eventQueue.push(event);
    };

    while (!sessionClosed) {
      if (eventQueue.length > 0) {
        const event = eventQueue.shift();
        yield event;
      } else {
        // Yield a small delay to avoid busy-waiting
        await Bun.sleep(10);
      }
    }

    // 5. End the audio content block
    yield {
      contentBlockEnd: {
        promptName,
        contentName: audioContentName,
      },
    };

    // 6. End the prompt
    yield {
      promptEnd: {
        promptName,
      },
    };

    // 7. End the session
    yield {
      sessionEnd: {},
    };
  }

  const command = new InvokeModelWithBidirectionalStreamCommand({
    modelId: env.BEDROCK_NOVA_SONIC_MODEL_ID,
    body: buildInputStream() as InvokeModelWithBidirectionalStreamInput["body"],
  });

  // Start the stream and process responses
  (async () => {
    try {
      const response = await client.send(command);

      for await (const event of response.body) {
        if (sessionClosed) break;
        await handleOutputEvent(event, {
          incident_id,
          callbacks,
          pendingToolUseId: { get: () => pendingToolUseId, set: (v) => { pendingToolUseId = v; } },
          pendingToolName: { get: () => pendingToolName, set: (v) => { pendingToolName = v; } },
          pendingToolInput: { get: () => pendingToolInput, set: (v) => { pendingToolInput = v; } },
          sendEvent: async (event: unknown) => {
            if (streamWriter) await streamWriter(event);
          },
          promptName,
        });
      }

      callbacks.onEnd("stream_complete");
    } catch (err) {
      if (!sessionClosed) {
        callbacks.onError(
          err instanceof Error ? err : new Error(String(err))
        );
      }
    } finally {
      clearTimeout(renewalTimer);
      sessionClosed = true;
    }
  })();

  return {
    async sendAudio(base64Pcm: string) {
      if (sessionClosed || !streamWriter) return;
      await streamWriter({
        audioInput: {
          promptName,
          contentName: crypto.randomUUID(),
          content: base64Pcm,
        },
      });
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
    sendEvent: (event: unknown) => Promise<void>;
    promptName: string;
  }
): Promise<void> {
  const ev = event as Record<string, unknown>;

  // Audio output
  if (ev["audioOutput"]) {
    const audio = ev["audioOutput"] as Record<string, unknown>;
    // If the previous textOutput had interrupted:true, we should have flushed
    // (barge-in handled below). Here just forward the audio.
    ctx.callbacks.onAudioOutput(audio["content"] as string);
    return;
  }

  // Text output (transcript + barge-in detection)
  if (ev["textOutput"]) {
    const text = ev["textOutput"] as Record<string, unknown>;
    const content = text["content"] as string;

    // Barge-in: caller interrupted the agent
    if (text["interrupted"] === true) {
      // Signal caller to flush audio queue — we do this by sending an empty
      // onAudioOutput with a sentinel value the caller handler can detect.
      // The actual audio queue flush happens in callHandler.ts.
      ctx.callbacks.onAudioOutput("__FLUSH__");
      return;
    }

    if (content) {
      ctx.callbacks.onTranscript("agent", content);
    }
    return;
  }

  // Tool use — accumulate until contentEnd with TOOL_USE stopReason
  if (ev["toolUse"]) {
    const tool = ev["toolUse"] as Record<string, unknown>;
    ctx.pendingToolUseId.set(tool["toolUseId"] as string);
    ctx.pendingToolName.set(tool["toolName"] as string);
    ctx.pendingToolInput.set("");
    return;
  }

  // Tool input delta (streamed JSON input)
  if (ev["toolInputDelta"]) {
    const delta = ev["toolInputDelta"] as Record<string, unknown>;
    ctx.pendingToolInput.set(
      ctx.pendingToolInput.get() + (delta["delta"] as string ?? "")
    );
    return;
  }

  // Content end — if TOOL_USE, execute tool and send result
  if (ev["contentBlockDelta"]) {
    // Ignore — tool input comes via toolInputDelta
    return;
  }

  if (ev["contentEnd"]) {
    const end = ev["contentEnd"] as Record<string, unknown>;

    if (end["stopReason"] === "TOOL_USE") {
      const toolUseId = ctx.pendingToolUseId.get();
      const toolName = ctx.pendingToolName.get();
      const toolInputStr = ctx.pendingToolInput.get();

      if (!toolUseId || !toolName) return;

      const toolResult = await executeTool(
        toolName,
        toolInputStr,
        ctx.incident_id
      );

      // Send tool result — MUST be on contentEnd with stopReason TOOL_USE
      const resultContentName = crypto.randomUUID();
      await ctx.sendEvent({
        contentBlockStart: {
          promptName: ctx.promptName,
          contentName: resultContentName,
          type: "TOOL_RESULT",
          toolResultConfiguration: {
            toolUseId,
            status: toolResult.success ? "success" : "error",
          },
        },
      });

      await ctx.sendEvent({
        toolResultInputDelta: {
          promptName: ctx.promptName,
          contentName: resultContentName,
          delta: JSON.stringify(toolResult.data),
        },
      });

      await ctx.sendEvent({
        contentBlockEnd: {
          promptName: ctx.promptName,
          contentName: resultContentName,
        },
      });

      ctx.pendingToolUseId.set(null);
      ctx.pendingToolName.set(null);
      ctx.pendingToolInput.set("");
    }
    return;
  }
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

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
