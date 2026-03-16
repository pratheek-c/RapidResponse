/**
 * Incidents REST routes.
 *
 * GET  /incidents            List incidents (optional ?status=active&limit=50&offset=0)
 * GET  /incidents/resolved   List resolved/completed incidents (shorthand)
 * GET  /incidents/:id        Get a single incident
 * PATCH /incidents/:id       Update an incident (status, summary, etc.)
 *
 * Role filtering:
 *   When the request carries X-Role: unit_officer and X-Unit-Id: <id>, incidents not
 *   assigned to that unit have sensitive fields (summary, s3 keys, officer_id) stripped so
 *   the frontend renders them as read-only cards only.
 */

import { getIncident, listIncidents, updateIncident } from "../services/incidentService.ts";
import { dbGetTranscription, dbGetDispatchActions, dbGetDispatchQuestions, dbListIncidentUnits } from "../db/libsql.ts";
import { getDb } from "../db/libsql.ts";
import type { UpdateIncidentInput } from "../types/index.ts";

// ---------------------------------------------------------------------------
// Role-based field stripping
// ---------------------------------------------------------------------------

type RoleContext = { role: string; unitId: string | null };

function getRoleContext(req: Request): RoleContext {
  return {
    role: req.headers.get("X-Role") ?? "dispatcher",
    unitId: req.headers.get("X-Unit-Id"),
  };
}

function parseAssignedUnits(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // fall through
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * For unit officers: strip full-detail fields from incidents not assigned to them.
 * Dispatchers always get the full record.
 */
function applyRoleFilter<T extends { assigned_units?: string | null; summary?: string | null; s3_audio_prefix?: string | null; s3_transcript_key?: string | null; officer_id?: string | null }>(
  incident: T,
  ctx: RoleContext
): T {
  if (ctx.role !== "unit_officer" || !ctx.unitId) return incident;
  const assignedUnits = parseAssignedUnits(incident.assigned_units ?? null);
  if (assignedUnits.includes(ctx.unitId)) return incident;
  // Not their incident — strip sensitive / full-detail fields
  return {
    ...incident,
    summary: null,
    s3_audio_prefix: null,
    s3_transcript_key: null,
    officer_id: null,
  };
}

export async function handleIncidents(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathParts = url.pathname.replace(/^\//, "").split("/");
  // pathParts[0] = "incidents", pathParts[1] = optional id or "resolved"

  const ctx = getRoleContext(req);

  if (pathParts.length === 1) {
    // /incidents
    if (req.method === "GET") {
      const status = url.searchParams.get("status") ?? undefined;
      const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
      const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

      try {
        const incidents = await listIncidents({ ...(status !== undefined ? { status } : {}), limit, offset });
        const filtered = incidents.map((inc) => applyRoleFilter(inc, ctx));
        return json({ ok: true, data: filtered });
      } catch (err) {
        return jsonError(err, 500);
      }
    }
    return notAllowed();
  }

  const id = pathParts[1];
  if (!id) return badRequest("Missing incident ID");

  // GET /incidents/resolved — must be checked before /:id
  if (id === "resolved" && req.method === "GET") {
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
    try {
      // Return both "resolved" and "completed" incidents
      const [resolved, completed] = await Promise.all([
        listIncidents({ status: "resolved", limit, offset }),
        listIncidents({ status: "completed", limit, offset }),
      ]);
      // Merge, apply role filter, and sort by updated_at descending
      const all = [...resolved, ...completed]
        .map((inc) => applyRoleFilter(inc, ctx))
        .sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
      return json({ ok: true, data: all });
    } catch (err) {
      return jsonError(err, 500);
    }
  }

  // /incidents/:id/transcript
  if (pathParts[2] === "transcript") {
    if (req.method !== "GET") return notAllowed();
    try {
      const turns = await dbGetTranscription(getDb(), id);
      return json({ ok: true, data: turns });
    } catch (err) {
      return jsonError(err, 500);
    }
  }

  // /incidents/:id/actions
  if (pathParts[2] === "actions") {
    if (req.method !== "GET") return notAllowed();
    try {
      const actions = await dbGetDispatchActions(getDb(), id);
      return json({ ok: true, data: actions });
    } catch (err) {
      return jsonError(err, 500);
    }
  }

  // /incidents/:id/questions
  if (pathParts[2] === "questions") {
    if (req.method !== "GET") return notAllowed();
    try {
      const questions = await dbGetDispatchQuestions(getDb(), id);
      return json({ ok: true, data: questions });
    } catch (err) {
      return jsonError(err, 500);
    }
  }

  // /incidents/:id/units
  if (pathParts[2] === "units") {
    if (req.method !== "GET") return notAllowed();
    try {
      const units = await dbListIncidentUnits(getDb(), id);
      return json({ ok: true, data: units });
    } catch (err) {
      return jsonError(err, 500);
    }
  }

  if (req.method === "GET") {
    try {
      const incident = await getIncident(id);
      if (!incident) return json({ ok: false, error: "Not found" }, 404);
      return json({ ok: true, data: applyRoleFilter(incident, ctx) });
    } catch (err) {
      return jsonError(err, 500);
    }
  }

  if (req.method === "PATCH") {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body");
    }

    try {
      const input = body as UpdateIncidentInput;
      const updated = await updateIncident(id, input);
      if (!updated) return json({ ok: false, error: "Not found" }, 404);
      return json({ ok: true, data: updated });
    } catch (err) {
      return jsonError(err, 500);
    }
  }

  return notAllowed();
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

function jsonError(err: unknown, status: number): Response {
  const message = err instanceof Error ? err.message : String(err);
  return json({ ok: false, error: message }, status);
}

function badRequest(message: string): Response {
  return json({ ok: false, error: message }, 400);
}

function notAllowed(): Response {
  return json({ ok: false, error: "Method not allowed" }, 405);
}
