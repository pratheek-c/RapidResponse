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
