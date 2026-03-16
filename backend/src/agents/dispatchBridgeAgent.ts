/**
 * Dispatch Bridge Agent — Nova Lite
 *
 * Two operations:
 *
 * 1. refineQuestion(question, transcript)
 *    Takes a raw dispatcher question and the call transcript so far, returns
 *    a rephrased question optimised for Nova Sonic to relay to the caller.
 *    (e.g. jargon removed, concise, natural-speech-friendly)
 *
 * 2. extractAnswer(question, transcript)
 *    Scans the transcript for an answer to the question already provided by
 *    the caller.  Returns the answer text, or null if not found.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { env } from "../config/env.ts";

// ---------------------------------------------------------------------------
// Lazy Bedrock client
// ---------------------------------------------------------------------------

let _client: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  if (!_client) {
    _client = new BedrockRuntimeClient({
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
    });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TranscriptEntry = { role: "caller" | "agent"; text: string };

type NovaLiteMessage = {
  role: "user" | "assistant";
  content: { text: string }[];
};

type NovaLiteRequestBody = {
  messages: NovaLiteMessage[];
  inferenceConfig: { maxTokens: number; temperature: number };
};

// ---------------------------------------------------------------------------
// Shared helper — invoke Nova Lite and return the text output
// ---------------------------------------------------------------------------

async function invokeLite(prompt: string, maxTokens = 256): Promise<string> {
  const body: NovaLiteRequestBody = {
    messages: [{ role: "user", content: [{ text: prompt }] }],
    inferenceConfig: { maxTokens, temperature: 0.2 },
  };

  const cmd = new InvokeModelCommand({
    modelId: env.BEDROCK_NOVA_LITE_MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(body),
  });

  const resp = await getClient().send(cmd);
  const rawBody = new TextDecoder().decode(resp.body);
  const parsed = JSON.parse(rawBody) as {
    output?: { message?: { content?: { text?: string }[] } };
  };
  return parsed.output?.message?.content?.[0]?.text ?? "";
}

// ---------------------------------------------------------------------------
// refineQuestion
// ---------------------------------------------------------------------------

/**
 * Rephrase a dispatcher's question so Nova Sonic can relay it naturally.
 * Falls back to the original question on any error.
 */
export async function refineQuestion(
  question: string,
  transcript: TranscriptEntry[]
): Promise<string> {
  const recentLines = transcript
    .slice(-10)
    .map((t) => `${t.role === "caller" ? "CALLER" : "AGENT"}: ${t.text}`)
    .join("\n");

  const prompt = `You are a 911 call assistant. A dispatcher wants the AI agent to ask the caller:
"${question}"

Recent call transcript:
${recentLines || "(call just started)"}

Rephrase the dispatcher's question as a single, short, conversational sentence the AI agent can speak naturally to the caller.
Remove jargon. Be direct. Return ONLY the rephrased question — no explanation, no quotes around it.`;

  try {
    console.log(`[bridge:refine] Calling Nova Lite for refineQuestion...`);
    const refined = (await invokeLite(prompt, 128)).trim();
    console.log(`[bridge:refine] Nova Lite returned: "${refined}"`);
    // Guard: if Nova Lite returns something clearly wrong (empty / very long), fall back
    if (refined.length > 0 && refined.length < 300) return refined;
    return question;
  } catch (err) {
    console.error("[dispatchBridge] refineQuestion failed:", err instanceof Error ? err.message : String(err));
    return question;
  }
}

// ---------------------------------------------------------------------------
// extractAnswer
// ---------------------------------------------------------------------------

/**
 * Look through the call transcript for the caller's answer to `question`.
 * Returns the answer text (≤ 200 chars) or null if not answered yet.
 */
export async function extractAnswer(
  question: string,
  transcript: TranscriptEntry[]
): Promise<string | null> {
  const recentLines = transcript
    .slice(-14)
    .map((t) => `${t.role === "caller" ? "CALLER" : "AGENT"}: ${t.text}`)
    .join("\n");

  if (!recentLines.trim()) return null;

  const prompt = `You are extracting information from a 911 call transcript.

Question asked by dispatcher: "${question}"

Recent transcript lines:
${recentLines}

Has the caller answered this question? If yes, summarise their answer in one short sentence (max 150 chars).
If the caller has NOT answered yet, reply with the single word: UNANSWERED
Return ONLY the answer sentence OR the word UNANSWERED.`;

  try {
    console.log(`[bridge:extract] Calling Nova Lite to extract answer to "${question}"...`);
    const raw = (await invokeLite(prompt, 128)).trim();
    console.log(`[bridge:extract] Nova Lite returned: "${raw}"`);
    if (raw.toUpperCase() === "UNANSWERED" || raw.length === 0) return null;
    return raw.slice(0, 200);
  } catch (err) {
    console.error("[dispatchBridge] extractAnswer failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}
