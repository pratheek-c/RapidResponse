/**
 * Incidents REST routes.
 *
 * GET  /incidents          List incidents (optional ?status=active&limit=50&offset=0)
 * GET  /incidents/:id      Get a single incident
 * PATCH /incidents/:id     Update an incident (status, summary, etc.)
 */

import { getIncident, listIncidents, updateIncident } from "../services/incidentService.ts";
import type { UpdateIncidentInput } from "../types/index.ts";

export async function handleIncidents(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathParts = url.pathname.replace(/^\//, "").split("/");
  // pathParts[0] = "incidents", pathParts[1] = optional id

  if (pathParts.length === 1) {
    // /incidents
    if (req.method === "GET") {
      const status = url.searchParams.get("status") ?? undefined;
      const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
      const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

      try {
        const incidents = await listIncidents({ status, limit, offset });
        return json({ ok: true, data: incidents });
      } catch (err) {
        return jsonError(err, 500);
      }
    }
    return notAllowed();
  }

  const id = pathParts[1];
  if (!id) return badRequest("Missing incident ID");

  if (req.method === "GET") {
    try {
      const incident = await getIncident(id);
      if (!incident) return json({ ok: false, error: "Not found" }, 404);
      return json({ ok: true, data: incident });
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
