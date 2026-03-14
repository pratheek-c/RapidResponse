/**
 * Units REST routes.
 *
 * GET  /units          List units (optional ?status=available&type=ems)
 * GET  /units/:id      Get a single unit
 * POST /units          Create a unit (admin/seed use)
 * PATCH /units/:id     Update unit status
 */

import {
  dbListUnits,
  dbGetUnit,
  dbCreateUnit,
  dbUpdateUnitStatus,
  getDb,
} from "../db/libsql.ts";
import type { UnitStatus, UnitType } from "../types/index.ts";

export async function handleUnits(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathParts = url.pathname.replace(/^\//, "").split("/");
  const db = getDb();

  if (pathParts.length === 1) {
    if (req.method === "GET") {
      const status = url.searchParams.get("status") as UnitStatus | undefined ?? undefined;
      const type = url.searchParams.get("type") ?? undefined;

      try {
        const units = await dbListUnits(db, { status, type });
        return json({ ok: true, data: units });
      } catch (err) {
        return jsonError(err, 500);
      }
    }

    if (req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return badRequest("Invalid JSON body");
      }

      const input = body as {
        unit_code: string;
        type: UnitType;
        status?: UnitStatus;
      };

      if (!input.unit_code || !input.type) {
        return badRequest("unit_code and type are required");
      }

      try {
        const unit = await dbCreateUnit(db, {
          unit_code: input.unit_code,
          type: input.type,
          status: input.status ?? "available",
          current_incident_id: null,
        });
        return json({ ok: true, data: unit }, 201);
      } catch (err) {
        return jsonError(err, 500);
      }
    }

    return notAllowed();
  }

  const id = pathParts[1];
  if (!id) return badRequest("Missing unit ID");

  if (req.method === "GET") {
    try {
      const unit = await dbGetUnit(db, id);
      if (!unit) return json({ ok: false, error: "Not found" }, 404);
      return json({ ok: true, data: unit });
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

    const input = body as { status: UnitStatus; current_incident_id?: string | null };
    if (!input.status) return badRequest("status is required");

    try {
      await dbUpdateUnitStatus(db, id, input.status, input.current_incident_id ?? null);
      const unit = await dbGetUnit(db, id);
      return json({ ok: true, data: unit });
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
