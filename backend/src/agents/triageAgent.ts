/**
 * Triage Agent — pure local logic (no LLM calls).
 *
 * evaluateEscalation(transcript, extraction, currentPriority)
 *
 * Analyses the current call state and returns an escalation suggestion
 * if the situation warrants additional unit types beyond what is already
 * dispatched.
 *
 * Rules (conservative, ordered by severity):
 *  1. Fire keywords AND no fire unit → suggest fire
 *  2. Cardiac / unconscious / not breathing keywords → suggest medical
 *  3. Weapon / shooting / stabbing keywords → suggest patrol (police)
 *  4. Chemical / gas / smoke / leak keywords → suggest hazmat
 *  5. Multiple victims → bump reason label to "multiple casualties"
 *
 * Returns null if no escalation is needed.
 */

import type { Department, IncidentPriority } from "../types/index.ts";
import type { ExtractionResult } from "../services/extractionService.ts";
import { getDb, dbUpdateUnitStatus, dbGetIncident, dbUpdateIncident } from "../db/libsql.ts";
import { pushSSE } from "../services/sseService.ts";
import { haversine } from "../utils/haversine.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EscalationSuggestion = {
  reason: string;
  suggested_units: Department[];
};

// ---------------------------------------------------------------------------
// Keyword sets
// ---------------------------------------------------------------------------

const FIRE_KEYWORDS = [
  "fire", "flames", "burning", "smoke", "wildfire", "structure fire",
  "house fire", "car fire", "explosion",
];

const MEDICAL_KEYWORDS = [
  "unconscious", "not breathing", "cardiac", "heart attack", "stroke",
  "seizure", "bleeding out", "overdose", "unresponsive", "chest pain",
  "collapsed", "choking",
];

const POLICE_KEYWORDS = [
  "gun", "shooting", "shot", "stabbing", "knife", "weapon", "armed",
  "robbery", "assault", "threat", "hostage", "violence", "attack",
];

const HAZMAT_KEYWORDS = [
  "chemical", "hazmat", "gas leak", "toxic", "spill", "fumes",
  "carbon monoxide", "ammonia", "chlorine", "radiation",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function containsAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

function transcriptText(
  transcript: { role: "caller" | "agent"; text: string }[]
): string {
  return transcript
    .filter((t) => t.role === "caller")
    .map((t) => t.text)
    .join(" ");
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Evaluate whether additional units should be escalated based on the
 * current call state.  Returns a suggestion or null.
 *
 * @param transcript      All transcript turns so far
 * @param extraction      Latest extraction result (may be null if not run yet)
 * @param currentPriority Current incident priority (P1–P4) or null
 * @param dispatchedTypes Unit types already assigned to this incident
 */
export function evaluateEscalation(
  transcript: { role: "caller" | "agent"; text: string }[],
  extraction: ExtractionResult | null,
  currentPriority: IncidentPriority | null,
  dispatchedTypes: Department[]
): EscalationSuggestion | null {
  const callerText = transcriptText(transcript);
  const hazards = (extraction?.hazards_mentioned ?? []).join(" ");
  const combined = `${callerText} ${hazards}`;

  const suggested: Department[] = [];
  const reasons: string[] = [];

  // Rule 1 — fire
  if (containsAny(combined, FIRE_KEYWORDS) && !dispatchedTypes.includes("fire")) {
    suggested.push("fire");
    reasons.push("fire indicators detected");
  }

  // Rule 2 — medical
  if (containsAny(combined, MEDICAL_KEYWORDS) && !dispatchedTypes.includes("medical")) {
    suggested.push("medical");
    reasons.push("medical emergency indicators detected");
  }

  // Rule 3 — police / patrol
  if (containsAny(combined, POLICE_KEYWORDS) && !dispatchedTypes.includes("patrol")) {
    suggested.push("patrol");
    reasons.push("weapon or violence indicators detected");
  }

  // Rule 4 — hazmat
  if (containsAny(combined, HAZMAT_KEYWORDS) && !dispatchedTypes.includes("hazmat")) {
    suggested.push("hazmat");
    reasons.push("hazardous material indicators detected");
  }

  // Rule 5 — multiple casualties modifier
  const victimCount = extraction?.victim_count ?? null;
  if (victimCount !== null && victimCount > 2 && !reasons.includes("medical emergency indicators detected")) {
    if (!dispatchedTypes.includes("medical")) {
      suggested.push("medical");
    }
    reasons.push("multiple casualties reported");
  }

  // P1 with nothing dispatched → always suggest patrol + medical minimum
  if (currentPriority === "P1" && dispatchedTypes.length === 0) {
    if (!suggested.includes("patrol")) suggested.push("patrol");
    if (!suggested.includes("medical")) suggested.push("medical");
    reasons.push("P1 priority with no units assigned");
  }

  if (suggested.length === 0) return null;

  return {
    reason: reasons.join("; "),
    suggested_units: [...new Set(suggested)],
  };
}

// ---------------------------------------------------------------------------
// Auto-assign
// ---------------------------------------------------------------------------

const TYPE_TO_DEPARTMENTS: Record<string, Department[]> = {
  medical:  ["medical"],
  fire:     ["fire"],
  police:   ["patrol"],
  traffic:  ["patrol", "medical"],
  hazmat:   ["hazmat", "fire"],
  other:    ["patrol"],
};

// Dublin city centre fallback coords
const FALLBACK_LAT = 53.3498;
const FALLBACK_LNG = -6.2603;

export type AutoAssignResult = {
  assigned_units: Array<{ unit_id: string; unit_type: Department; distance_km: number }>;
  auto_dispatched: boolean;
  needs_acceptance: boolean;
};

export function determineRequiredDepartments(incidentType: string): Department[] {
  return TYPE_TO_DEPARTMENTS[incidentType.toLowerCase()] ?? ["patrol"];
}

/**
 * Attempt to auto-assign available units to an incident.
 * - P3 / P4 → auto-dispatch immediately
 * - P1 / P2 → push assignment_suggested SSE (unit must accept)
 * Unit coordinates are not stored in libSQL; distance is always 0.
 * The haversine import is retained for future use when unit coords become available.
 */
export async function autoAssign(
  incidentId: string,
  incidentType: string,
  priority: IncidentPriority,
  lat: number = FALLBACK_LAT,
  lng: number = FALLBACK_LNG,
): Promise<AutoAssignResult> {
  // Suppress unused-variable warning — kept for future coord-based ranking
  void haversine(lat, lng, FALLBACK_LAT, FALLBACK_LNG);

  const db = getDb();
  const requiredDepts = determineRequiredDepartments(incidentType);

  // P3 / P4 = auto-dispatch; P1 / P2 = suggestion only
  const shouldAutoDispatch = priority === "P3" || priority === "P4";

  const assigned: AutoAssignResult["assigned_units"] = [];

  for (const dept of requiredDepts) {
    // Map Department → UnitType used in the units table
    const unitType =
      dept === "patrol"  ? "police"
      : dept === "medical" ? "ems"
      : dept; // "fire" | "hazmat" map directly

    // Find first available unit of this type
    const result = await db.execute({
      sql: "SELECT id, type FROM units WHERE status = 'available' AND type = :type ORDER BY created_at LIMIT 1",
      args: { type: unitType },
    });

    if (result.rows.length === 0) continue;

    const row = result.rows[0] as Record<string, unknown>;
    const unitId = row["id"] as string;

    if (shouldAutoDispatch) {
      // Update unit to dispatched
      await dbUpdateUnitStatus(db, unitId, "dispatched", incidentId);

      // Update incident assigned_units
      const incident = await dbGetIncident(db, incidentId);
      if (incident) {
        const existing: string[] = incident.assigned_units
          ? (JSON.parse(incident.assigned_units) as string[])
          : [];
        if (!existing.includes(unitId)) {
          existing.push(unitId);
          await dbUpdateIncident(db, incidentId, { assigned_units: JSON.stringify(existing) });
        }
      }

      pushSSE({
        type: "unit_auto_dispatched",
        data: { incident_id: incidentId, unit_id: unitId, unit_type: dept, auto: true },
      } as Parameters<typeof pushSSE>[0]);
    } else {
      // Suggestion only — send targeted SSE (frontend filters by own unit id)
      pushSSE({
        type: "assignment_suggested",
        data: {
          incident_id: incidentId,
          suggested_unit: unitId,
          unit_type: dept,
          distance_km: 0,
          priority,
        },
      } as Parameters<typeof pushSSE>[0]);
    }

    assigned.push({ unit_id: unitId, unit_type: dept, distance_km: 0 });
  }

  return {
    assigned_units: assigned,
    auto_dispatched: shouldAutoDispatch,
    needs_acceptance: !shouldAutoDispatch,
  };
}
