/**
 * Report route.
 *
 * GET /report/:incident_id  — Returns the latest cached incident report.
 *
 * Reports are generated in-memory by the report agent during active calls.
 * This route provides HTTP access for clients that missed WS push events.
 */

import type { IncidentReport } from "../types/index.ts";

// ---------------------------------------------------------------------------
// In-memory report cache — incidentId → latest IncidentReport
// ---------------------------------------------------------------------------

const reportCache = new Map<string, IncidentReport>();

/**
 * Store or update the cached report for an incident.
 * Called by callHandler.ts whenever a new report is generated.
 */
export function cacheReport(report: IncidentReport): void {
  reportCache.set(report.incident_id, report);
}

/**
 * Retrieve the cached report for an incident (returns null if none yet).
 */
export function getCachedReport(incidentId: string): IncidentReport | null {
  return reportCache.get(incidentId) ?? null;
}

/**
 * Remove a report from cache after the call ends (optional cleanup).
 */
export function evictReport(incidentId: string): void {
  reportCache.delete(incidentId);
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

export async function handleReport(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathParts = url.pathname.replace(/^\//, "").split("/");
  // pathParts[0] === "report", pathParts[1] === incident_id
  const incidentId = pathParts[1];

  if (!incidentId) {
    return json({ ok: false, error: "incident_id is required" }, 400);
  }

  if (req.method !== "GET") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const report = getCachedReport(incidentId);
  if (!report) {
    return json({ ok: false, error: "No report found for this incident" }, 404);
  }

  return json({ ok: true, data: report });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
