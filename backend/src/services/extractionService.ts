/**
 * Extraction service.
 *
 * Runs a 3-second debounced Nova Lite extraction after each AI transcript turn.
 * Extracts structured fields from the growing call transcript:
 *   - caller_name, caller_phone (if mentioned)
 *   - incident_type, suspected_cause
 *   - victim_count, injuries_described
 *   - hazards_mentioned
 *   - key_location_details (floor, unit, intersection)
 *
 * Each call to `maybeExtract()` resets the debounce timer.
 * When the timer fires, the extraction runs and an SSE event is pushed.
 *
 * The extraction result is stored in-memory per incident_id so routes
 * can serve it synchronously without a DB round-trip.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { env } from "../config/env.ts";
import { pushSSE } from "./sseService.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExtractionResult = {
  incident_id: string;
  caller_name: string | null;
  caller_phone: string | null;
  incident_type: string | null;
  suspected_cause: string | null;
  victim_count: number | null;
  injuries_described: string | null;
  hazards_mentioned: string[];
  key_location_details: string | null;
  extracted_at: string; // ISO 8601
};

// ---------------------------------------------------------------------------
// In-memory cache of latest extraction per incident
// ---------------------------------------------------------------------------

const _cache = new Map<string, ExtractionResult>();

export function getExtraction(incident_id: string): ExtractionResult | null {
  return _cache.get(incident_id) ?? null;
}

export function evictExtraction(incident_id: string): void {
  _cache.delete(incident_id);
}

// ---------------------------------------------------------------------------
// Debounce timers per incident
// ---------------------------------------------------------------------------

const _timers = new Map<string, ReturnType<typeof setTimeout>>();

const DEBOUNCE_MS = 3_000;

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
// Main API
// ---------------------------------------------------------------------------

/**
 * Called after each AI transcript turn.
 * Resets the 3-second debounce timer, then runs extraction when it fires.
 *
 * @param incident_id  The active incident UUID
 * @param transcript   Accumulated transcript turns as "ROLE: text" lines
 */
export function maybeExtract(
  incident_id: string,
  transcript: { role: "caller" | "agent"; text: string }[]
): void {
  // Clear any existing timer for this incident
  const existing = _timers.get(incident_id);
  if (existing !== undefined) clearTimeout(existing);

  const timer = setTimeout(() => {
    _timers.delete(incident_id);
    runExtraction(incident_id, transcript).catch((err: unknown) => {
      console.error(
        "[extraction] failed for incident",
        incident_id,
        err instanceof Error ? err.message : String(err)
      );
    });
  }, DEBOUNCE_MS);

  _timers.set(incident_id, timer);
}

/**
 * Cancel any pending extraction timer for an incident (call on end/finalize).
 */
export function cancelExtraction(incident_id: string): void {
  const existing = _timers.get(incident_id);
  if (existing !== undefined) {
    clearTimeout(existing);
    _timers.delete(incident_id);
  }
}

// ---------------------------------------------------------------------------
// Extraction runner
// ---------------------------------------------------------------------------

type NovaLiteMessage = {
  role: "user" | "assistant";
  content: { text: string }[];
};

type NovaLiteRequestBody = {
  messages: NovaLiteMessage[];
  inferenceConfig: { maxTokens: number; temperature: number };
};

async function runExtraction(
  incident_id: string,
  transcript: { role: "caller" | "agent"; text: string }[]
): Promise<void> {
  // Take only caller turns to avoid prompt bloat
  const callerLines = transcript
    .filter((t) => t.role === "caller")
    .slice(-30) // cap to last 30 caller turns
    .map((t) => `CALLER: ${t.text}`)
    .join("\n");

  if (!callerLines.trim()) return;

  const systemPrompt = `You are an information extraction engine for 911 emergency dispatchers.
Given caller transcript lines, extract structured facts.
Return ONLY valid JSON — no markdown fences, no explanation.`;

  const userPrompt = `Transcript:
${callerLines}

Return a JSON object with these exact keys (use null or [] if unknown):
{
  "caller_name": string | null,
  "caller_phone": string | null,
  "incident_type": string | null,
  "suspected_cause": string | null,
  "victim_count": number | null,
  "injuries_described": string | null,
  "hazards_mentioned": string[],
  "key_location_details": string | null
}`;

  let result: ExtractionResult = {
    incident_id,
    caller_name: null,
    caller_phone: null,
    incident_type: null,
    suspected_cause: null,
    victim_count: null,
    injuries_described: null,
    hazards_mentioned: [],
    key_location_details: null,
    extracted_at: new Date().toISOString(),
  };

  try {
    const body: NovaLiteRequestBody = {
      messages: [
        {
          role: "user",
          content: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
        },
      ],
      inferenceConfig: { maxTokens: 400, temperature: 0.1 },
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
    const text = parsed.output?.message?.content?.[0]?.text ?? "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const extracted = JSON.parse(jsonMatch[0]) as Partial<Omit<ExtractionResult, "incident_id" | "extracted_at">>;
      result = {
        incident_id,
        caller_name: extracted.caller_name ?? null,
        caller_phone: extracted.caller_phone ?? null,
        incident_type: extracted.incident_type ?? null,
        suspected_cause: extracted.suspected_cause ?? null,
        victim_count: typeof extracted.victim_count === "number" ? extracted.victim_count : null,
        injuries_described: extracted.injuries_described ?? null,
        hazards_mentioned: Array.isArray(extracted.hazards_mentioned) ? extracted.hazards_mentioned : [],
        key_location_details: extracted.key_location_details ?? null,
        extracted_at: new Date().toISOString(),
      };
    }
  } catch (err) {
    // Non-fatal — push whatever we have (empty extraction is still useful to reset UI)
    console.error("[extraction] Nova Lite call failed:", err instanceof Error ? err.message : String(err));
  }

  // Update cache
  _cache.set(incident_id, result);

  // Push SSE to dispatcher dashboard
  pushSSE({
    type: "extraction_update",
    data: {
      incident_id,
      extraction: result as unknown as Record<string, unknown>,
    },
  });
}
