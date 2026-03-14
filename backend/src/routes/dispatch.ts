/**
 * Dispatch REST routes.
 *
 * POST  /dispatch                 Manually dispatch a unit (admin override)
 * GET   /dispatch/:incident_id    Get dispatches for an incident
 * PATCH /dispatch/:dispatch_id/arrive  Mark unit arrived
 * PATCH /dispatch/:dispatch_id/clear   Clear unit (return to available)
 */

import {
  dbCreateDispatch,
  dbGetDispatchesForIncident,
  getDb,
} from "../db/libsql.ts";
import { dispatchUnit, markUnitArrived, clearUnit } from "../services/dispatchService.ts";
import type { UnitType } from "../types/index.ts";

export async function handleDispatch(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // Strip leading /dispatch
  const subPath = url.pathname.replace(/^\/dispatch\/?/, "");
  const parts = subPath ? subPath.split("/") : [];

  // POST /dispatch — manual dispatch
  if (req.method === "POST" && parts.length === 0) {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body");
    }

    const input = body as { incident_id: string; unit_type: UnitType };
    if (!input.incident_id || !input.unit_type) {
      return badRequest("incident_id and unit_type are required");
    }

    try {
      const result = await dispatchUnit(input.incident_id, input.unit_type);
      return json({ ok: true, data: result }, 201);
    } catch (err) {
      return jsonError(err, 500);
    }
  }

  // GET /dispatch/:incident_id
  if (req.method === "GET" && parts.length === 1) {
    const incident_id = parts[0];
    if (!incident_id) return badRequest("Missing incident_id");

    const db = getDb();
    try {
      const dispatches = await dbGetDispatchesForIncident(db, incident_id);
      return json({ ok: true, data: dispatches });
    } catch (err) {
      return jsonError(err, 500);
    }
  }

  // PATCH /dispatch/:dispatch_id/arrive
  if (req.method === "PATCH" && parts.length === 2 && parts[1] === "arrive") {
    const dispatch_id = parts[0];
    if (!dispatch_id) return badRequest("Missing dispatch_id");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body");
    }

    const input = body as { unit_id: string };
    if (!input.unit_id) return badRequest("unit_id is required");

    try {
      await markUnitArrived(dispatch_id, input.unit_id);
      return json({ ok: true, data: { arrived: true } });
    } catch (err) {
      return jsonError(err, 500);
    }
  }

  // PATCH /dispatch/:dispatch_id/clear
  if (req.method === "PATCH" && parts.length === 2 && parts[1] === "clear") {
    const dispatch_id = parts[0];
    if (!dispatch_id) return badRequest("Missing dispatch_id");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body");
    }

    const input = body as { unit_id: string };
    if (!input.unit_id) return badRequest("unit_id is required");

    try {
      await clearUnit(dispatch_id, input.unit_id);
      return json({ ok: true, data: { cleared: true } });
    } catch (err) {
      return jsonError(err, 500);
    }
  }

  return notFound();
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

function notFound(): Response {
  return json({ ok: false, error: "Not found" }, 404);
}
