/**
 * Minimal Nova Sonic connectivity test.
 * Run: bun scripts/testNovaSonic.ts
 */

import {
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { NodeHttp2Handler } from "@smithy/node-http-handler";
import { env } from "../src/config/env.ts";

const MODEL_ID = env.BEDROCK_NOVA_SONIC_MODEL_ID;
const REGION = env.AWS_REGION;
console.log(`Testing Nova Sonic: model=${MODEL_ID} region=${REGION}`);

const client = new BedrockRuntimeClient({
  region: REGION,
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
    requestTimeout: 30000,
    sessionTimeout: 30000,
  }),
});

function enc(eventType: string, payload: Record<string, unknown>) {
  return {
    chunk: {
      bytes: new TextEncoder().encode(JSON.stringify({ event: { [eventType]: payload } })),
    },
  };
}

const promptName = crypto.randomUUID();
const sysCN = crypto.randomUUID();
const audioCN = crypto.randomUUID();

let closed = false;

async function* input() {
  console.log("→ sessionStart");
  yield enc("sessionStart", {
    inferenceConfiguration: { maxTokens: 512, topP: 0.9, temperature: 0.7 },
  });

  console.log("→ promptStart (with tools)");
  yield enc("promptStart", {
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
      tools: [
        {
          toolSpec: {
            name: "classify_incident",
            description: "Classify the emergency incident type and priority once you have enough information from the caller.",
            inputSchema: {
              json: JSON.stringify({
                type: "object",
                properties: {
                  type: { type: "string", enum: ["fire", "medical", "police", "traffic", "hazmat", "search_rescue", "other"] },
                  priority: { type: "string", enum: ["P1", "P2", "P3", "P4"], description: "Incident priority: P1=life-threatening, P2=urgent, P3=standard, P4=non-urgent." },
                },
                required: ["type", "priority"],
              }),
            },
          },
        },
        {
          toolSpec: {
            name: "get_protocol",
            description: "Retrieve relevant emergency response protocol guidance for the current situation.",
            inputSchema: {
              json: JSON.stringify({
                type: "object",
                properties: {
                  query: { type: "string", description: "A natural-language description of the situation to look up protocol for." },
                },
                required: ["query"],
              }),
            },
          },
        },
        {
          toolSpec: {
            name: "dispatch_unit",
            description: "Request dispatch of an emergency unit to the incident location.",
            inputSchema: {
              json: JSON.stringify({
                type: "object",
                properties: {
                  incident_id: { type: "string" },
                  unit_type: { type: "string", enum: ["fire", "ems", "police", "hazmat", "rescue"] },
                },
                required: ["incident_id", "unit_type"],
              }),
            },
          },
        },
      ],
    },
  });

  console.log("→ contentStart SYSTEM");
  yield enc("contentStart", {
    promptName, contentName: sysCN,
    type: "TEXT", interactive: false, role: "SYSTEM",
    textInputConfiguration: { mediaType: "text/plain" },
  });
  const sysPrompt = `You are a highly efficient, empathetic human agent handling a live 911 emergency call for Springfield PD in Springfield. You are speaking to the caller over a real-time audio connection.

Current call context:
- Incident ID: test-001
- Caller reported location: 53.339618, -6.274695 (The Coombe, Dublin)
- Department: Springfield PD

[PROTOCOL CONTEXT]

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
  yield enc("textInput", { promptName, contentName: sysCN, content: sysPrompt });
  yield enc("contentEnd", { promptName, contentName: sysCN });

  // Text trigger to make Nova Sonic speak first
  const trigCN = crypto.randomUUID();
  console.log("→ contentStart TEXT trigger");
  yield enc("contentStart", {
    promptName, contentName: trigCN,
    type: "TEXT", interactive: true, role: "USER",
    textInputConfiguration: { mediaType: "text/plain" },
  });
  yield enc("textInput", { promptName, contentName: trigCN, content: "." });
  yield enc("contentEnd", { promptName, contentName: trigCN });

  console.log("→ contentStart AUDIO");
  yield enc("contentStart", {
    promptName, contentName: audioCN,
    type: "AUDIO", interactive: true, role: "USER",
    audioInputConfiguration: {
      mediaType: "audio/lpcm",
      sampleRateHertz: 16000, sampleSizeBits: 16, channelCount: 1,
      audioType: "SPEECH", encoding: "base64",
    },
  });

  // Send 1 second of silence to prime
  const silence = new Uint8Array(32000);
  let bin = "";
  for (let i = 0; i < silence.length; i++) bin += String.fromCharCode(silence[i]);
  console.log("→ audioInput (1s silence)");
  yield enc("audioInput", { promptName, contentName: audioCN, content: btoa(bin) });

  // Wait up to 15s for a response
  const deadline = Date.now() + 15000;
  while (!closed && Date.now() < deadline) {
    await Bun.sleep(200);
  }

  console.log("→ contentEnd + promptEnd + sessionEnd");
  yield enc("contentEnd", { promptName, contentName: audioCN });
  yield enc("promptEnd", { promptName });
  yield enc("sessionEnd", {});
}

try {
  const cmd = new InvokeModelWithBidirectionalStreamCommand({
    modelId: MODEL_ID,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: input() as any,
  });

  const response = await client.send(cmd);
  console.log("✓ client.send() succeeded — iterating response.body...");

  let eventCount = 0;
  for await (const event of response.body) {
    eventCount++;
    try {
      const raw = event as Record<string, unknown>;
      let parsed: Record<string, unknown>;
      if ("chunk" in raw) {
        const bytes = (raw["chunk"] as Record<string, unknown>)["bytes"] as Uint8Array;
        parsed = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
      } else {
        parsed = raw;
      }
      const ev = ("event" in parsed ? parsed["event"] : parsed) as Record<string, unknown>;
      const keys = Object.keys(ev);
      console.log(`← event[${eventCount}] keys:`, keys);
      if (keys.includes("audioOutput")) {
        console.log("  ✓ Got AUDIO OUTPUT — Nova Sonic is responding!");
        closed = true;
        break;
      }
      if (keys.includes("textOutput")) {
        const t = ev["textOutput"] as Record<string, unknown>;
        console.log("  ✓ Got TEXT OUTPUT:", t["content"]);
      }
    } catch (e) {
      console.log(`← event[${eventCount}] (unparseable):`, event);
    }

    if (eventCount > 30) {
      console.log("Got 30 events, stopping.");
      closed = true;
      break;
    }
  }
  console.log(`Done. Total events: ${eventCount}`);
} catch (err) {
  const msg = err instanceof Error ? err.message
    : JSON.stringify(err, Object.getOwnPropertyNames(err as object));
  console.error("✗ Error:", msg);
}
