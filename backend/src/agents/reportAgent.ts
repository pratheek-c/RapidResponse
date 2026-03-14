/**
 * Report Agent — Nova Lite (amazon.nova-lite-v1:0)
 *
 * Generates and updates a structured incident report as a call progresses.
 * Uses InvokeModelCommand (not bidirectional streaming) for text reasoning.
 *
 * Called periodically (every ~30s) and on key events (incident classified,
 * unit dispatched). Returns a structured IncidentReport JSON object.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { env } from "../config/env.ts";
import type {
  IncidentReport,
  IncidentType,
  IncidentPriority,
  IncidentStatus,
  TranscriptionTurn,
  DispatchedUnitSummary,
  DispatcherAssigned,
  ReportTimelineEvent,
} from "../types/index.ts";
import type { MockUnitWithDistance } from "../routes/units.ts";

// ---------------------------------------------------------------------------
// Types for mock data context
// ---------------------------------------------------------------------------

type MockDispatcherStation = {
  desk: string;
  coords: { lat: number; lng: number };
  address: string;
};

type MockDispatcher = {
  id: string;
  badge: string;
  name: string;
  shift: string;
  role: string;
  certifications: string[];
  station: MockDispatcherStation;
  assigned_zones: string[];
  status: string;
};

type MockZoneBbox = {
  sw: { lat: number; lng: number };
  ne: { lat: number; lng: number };
};

type MockZone = {
  id: string;
  name: string;
  bbox: MockZoneBbox;
  primary_units: string[];
  risk_level: string;
};

type MockHospital = {
  id: string;
  name: string;
  coords: { lat: number; lng: number };
  trauma_level: string;
  ER_beds_available: number;
  helipad: boolean;
  specialties: string[];
};

export type MockData = {
  dispatchers: MockDispatcher[];
  zones: MockZone[];
  hospitals: MockHospital[];
};

export type ReportContext = {
  incident_id: string;
  caller_location: string;
  caller_address: string;
  incident_type: IncidentType | null;
  priority: IncidentPriority | null;
  status: IncidentStatus;
  call_start_ms: number;
  transcript: TranscriptionTurn[];
  dispatched_units: MockUnitWithDistance[];
  assigned_dispatcher_id: string | null;
  mock_data: MockData;
};

// ---------------------------------------------------------------------------
// Lazy Bedrock client
// ---------------------------------------------------------------------------

let _client: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  if (!_client) {
    _client = new BedrockRuntimeClient({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Zone detection — find which zone bbox contains the caller coords
// ---------------------------------------------------------------------------

function detectZone(
  callerLocation: string,
  zones: MockZone[]
): string | null {
  const parts = callerLocation.split(",").map((s) => parseFloat(s.trim()));
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
  const [lat, lng] = parts;

  for (const zone of zones) {
    const { sw, ne } = zone.bbox;
    if (lat >= sw.lat && lat <= ne.lat && lng >= sw.lng && lng <= ne.lng) {
      return zone.id;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dispatcher assignment — pick on-duty dispatcher whose zones cover the incident
// ---------------------------------------------------------------------------

export function assignDispatcher(
  callerLocation: string,
  mock_data: MockData
): MockDispatcher | null {
  const zoneId = detectZone(callerLocation, mock_data.zones);
  const onDuty = mock_data.dispatchers.filter((d) => d.status === "on_duty");

  if (onDuty.length === 0) return null;

  if (zoneId) {
    // Prefer a dispatcher whose assigned_zones includes the incident zone
    const match = onDuty.find((d) => d.assigned_zones.includes(zoneId));
    if (match) return match;
  }

  // Fall back to first on-duty dispatcher
  return onDuty[0] ?? null;
}

// ---------------------------------------------------------------------------
// Build DispatcherAssigned from mock dispatcher
// ---------------------------------------------------------------------------

function buildDispatcherAssigned(
  dispatcher: MockDispatcher | null
): DispatcherAssigned | null {
  if (!dispatcher) return null;
  return {
    id: dispatcher.id,
    name: dispatcher.name,
    badge: dispatcher.badge,
    desk: dispatcher.station.desk,
    certifications: dispatcher.certifications,
  };
}

// ---------------------------------------------------------------------------
// Build DispatchedUnitSummary list from MockUnitWithDistance
// ---------------------------------------------------------------------------

function buildDispatchedUnits(units: MockUnitWithDistance[]): DispatchedUnitSummary[] {
  return units.map((u) => ({
    unit_code: u.unit_code,
    type: u.type,
    eta_minutes: u.eta_minutes,
    distance_km: u.distance_km,
    crew_lead: u.crew[0]?.name ?? "Unknown",
    crew: u.crew,
  }));
}

// ---------------------------------------------------------------------------
// Build timeline events from transcript turns
// ---------------------------------------------------------------------------

function buildTimeline(
  transcript: TranscriptionTurn[],
  callStartMs: number
): ReportTimelineEvent[] {
  const events: ReportTimelineEvent[] = [];
  const callerTurns = transcript.filter((t) => t.role === "caller");
  // Use every 3rd caller turn to keep timeline concise
  for (let i = 0; i < callerTurns.length; i += 3) {
    const turn = callerTurns[i];
    if (turn) {
      events.push({
        timestamp_ms: turn.timestamp_ms,
        event: `Caller: ${turn.text.slice(0, 120)}${turn.text.length > 120 ? "…" : ""}`,
      });
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Generate report via Nova Lite
// ---------------------------------------------------------------------------

type NovaLiteMessage = {
  role: "user" | "assistant";
  content: { text: string }[];
};

type NovaLiteRequestBody = {
  messages: NovaLiteMessage[];
  inferenceConfig: {
    maxTokens: number;
    temperature: number;
  };
};

export async function generateReport(ctx: ReportContext): Promise<IncidentReport> {
  const dispatcherMock = ctx.assigned_dispatcher_id
    ? (ctx.mock_data.dispatchers.find((d) => d.id === ctx.assigned_dispatcher_id) ?? null)
    : assignDispatcher(ctx.caller_location, ctx.mock_data);

  const dispatcherAssigned = buildDispatcherAssigned(dispatcherMock);
  const dispatchedUnits = buildDispatchedUnits(ctx.dispatched_units);
  const timeline = buildTimeline(ctx.transcript, ctx.call_start_ms);

  // Build transcript summary for prompt
  const transcriptText = ctx.transcript
    .slice(-20) // last 20 turns to keep prompt bounded
    .map((t) => `${t.role === "caller" ? "CALLER" : "AGENT"}: ${t.text}`)
    .join("\n");

  const nearestHospital = ctx.mock_data.hospitals.sort(
    (a, b) => a.ER_beds_available - b.ER_beds_available
  )[0];

  const systemPrompt = `You are an emergency incident report writer for ${env.DISPATCH_CITY} ${env.DISPATCH_DEPT}.
Given a partial 911 call transcript and context, produce a structured incident report as valid JSON.
Be concise. Do not fabricate details not present in the transcript.
If information is unknown, use null or empty arrays.
Return ONLY the JSON object — no markdown fences, no explanation.`;

  const userPrompt = `Incident ID: ${ctx.incident_id}
Location: ${ctx.caller_address} (${ctx.caller_location})
Type: ${ctx.incident_type ?? "unknown"}
Priority: ${ctx.priority ?? "unknown"}
Status: ${ctx.status}

Recent Transcript (last 20 turns):
${transcriptText || "(no transcript yet)"}

Dispatched Units: ${dispatchedUnits.length > 0 ? dispatchedUnits.map((u) => `${u.unit_code} (${u.type}, ETA ${u.eta_minutes} min, crew lead: ${u.crew_lead})`).join("; ") : "none yet"}
Assigned Dispatcher: ${dispatcherAssigned ? `${dispatcherAssigned.name} (${dispatcherAssigned.badge}, ${dispatcherAssigned.desk})` : "none assigned"}
Nearest Hospital: ${nearestHospital ? `${nearestHospital.name} (trauma level ${nearestHospital.trauma_level}, ${nearestHospital.ER_beds_available} ER beds)` : "unknown"}

Produce a JSON object with exactly these fields:
{
  "summary": "string — 1-2 sentence plain-language summary",
  "caller_details": "string — what we know about the caller's situation",
  "recommended_actions": ["string", ...]
}`;

  let summary = "Emergency call in progress.";
  let callerDetails = `Caller at ${ctx.caller_address}.`;
  let recommendedActions: string[] = [];

  try {
    const body: NovaLiteRequestBody = {
      messages: [
        {
          role: "user",
          content: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
        },
      ],
      inferenceConfig: {
        maxTokens: 512,
        temperature: 0.2,
      },
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

    // Extract JSON from response — strip any accidental markdown fences
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const extracted = JSON.parse(jsonMatch[0]) as {
        summary?: string;
        caller_details?: string;
        recommended_actions?: string[];
      };
      summary = extracted.summary ?? summary;
      callerDetails = extracted.caller_details ?? callerDetails;
      recommendedActions = extracted.recommended_actions ?? [];
    }
  } catch (err) {
    // Non-fatal — use fallback values; log so operators can investigate
    console.error("[reportAgent] Nova Lite invocation failed:", err instanceof Error ? err.message : String(err));
  }

  // Determine approaching unit (any dispatched unit with ETA <= 3 min)
  const approachingUnit = dispatchedUnits.find((u) => u.eta_minutes <= 3) ?? null;

  return {
    incident_id: ctx.incident_id,
    summary,
    incident_type: ctx.incident_type,
    priority: ctx.priority,
    caller_details: callerDetails,
    timeline,
    units_dispatched: dispatchedUnits,
    dispatcher_assigned: dispatcherAssigned,
    recommended_actions: recommendedActions,
    approaching_unit: approachingUnit
      ? {
          unit_code: approachingUnit.unit_code,
          eta_minutes: approachingUnit.eta_minutes,
          crew: approachingUnit.crew,
        }
      : null,
    status: ctx.status,
    generated_at: new Date().toISOString(),
  };
}
