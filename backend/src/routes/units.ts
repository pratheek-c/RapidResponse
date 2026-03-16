/**
 * Units REST routes.
 *
 * GET  /units          List units (optional ?status=available&type=ems)
 * GET  /units/mock     List mock units from dispatchers.json, with distance from ?lat,lng
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
import { haversine, etaMinutes } from "../utils/haversine.ts";
import { pushSSE } from "../services/sseService.ts";

// ---------------------------------------------------------------------------
// Mock data types (from backend/data/mock/dispatchers.json)
// ---------------------------------------------------------------------------

type MockCrewMember = {
  name: string;
  role: string;
};

type MockVehicle = {
  make: string;
  model: string;
  year: number;
  license: string;
  vin: string;
};

type MockCoords = {
  lat: number;
  lng: number;
};

type MockUnit = {
  unit_code: string;
  type: UnitType;
  status: UnitStatus;
  zone: string;
  station: string;
  station_coords: MockCoords;
  current_coords: MockCoords;
  current_incident_id: string | null;
  crew: MockCrewMember[];
  vehicle: MockVehicle;
  equipment: string[];
};

type MockDispatchersData = {
  units: MockUnit[];
};

export type MockUnitWithDistance = MockUnit & {
  distance_km: number;
  eta_minutes: number;
};

// Cache the parsed mock data to avoid re-reading on every request
let mockDataCache: MockDispatchersData | null = null;

async function getMockData(): Promise<MockDispatchersData> {
  if (mockDataCache) return mockDataCache;
  const file = Bun.file(new URL("../../data/mock/dispatchers.json", import.meta.url));
  const raw = (await file.json()) as MockDispatchersData;
  mockDataCache = raw;
  return raw;
}

/**
 * Return mock units enriched with distance and ETA from a given coordinate.
 * Exported for use by callHandler.ts to inject context into the Nova Sonic prompt.
 */
export async function getMockUnitsWithDistance(
  lat: number,
  lng: number
): Promise<MockUnitWithDistance[]> {
  const data = await getMockData();
  const units: MockUnitWithDistance[] = data.units.map((u) => {
    const dist = haversine(lat, lng, u.current_coords.lat, u.current_coords.lng);
    return {
      ...u,
      distance_km: Math.round(dist * 100) / 100,
      eta_minutes: etaMinutes(dist),
    };
  });
  units.sort((a, b) => a.distance_km - b.distance_km);
  return units;
}

export async function handleUnits(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathParts = url.pathname.replace(/^\//, "").split("/");
  const db = getDb();

  if (pathParts.length === 1) {
    if (req.method === "GET") {
      const status = url.searchParams.get("status") as UnitStatus | undefined ?? undefined;
      const type = url.searchParams.get("type") ?? undefined;

      try {
        const units = await dbListUnits(db, { ...(status !== undefined ? { status } : {}), ...(type !== undefined ? { type } : {}) });
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

  // POST /units/go-off-duty
  if (id === "go-off-duty" && req.method === "POST") {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body");
    }

    const input = body as { unit_id?: string };
    if (!input.unit_id) return badRequest("unit_id is required");

    try {
      const unit = await dbGetUnit(db, input.unit_id);
      if (!unit) return json({ ok: false, error: "Unit not found" }, 404);

      // If unit was assigned to an incident, push a status_change for that incident
      if (unit.current_incident_id) {
        pushSSE({
          type: "status_change",
          data: { incident_id: unit.current_incident_id, status: "active", unit_id: input.unit_id },
        });
      }

      await dbUpdateUnitStatus(db, input.unit_id, "available", null);

      pushSSE({
        type: "unit_status_change",
        data: { unit_id: input.unit_id, status: "available", assigned_incident: null },
      });

      return json({ ok: true });
    } catch (err) {
      return jsonError(err, 500);
    }
  }
  if (id === "mock" && req.method === "GET") {
    const latStr = url.searchParams.get("lat");
    const lngStr = url.searchParams.get("lng");
    const lat = latStr !== null ? parseFloat(latStr) : null;
    const lng = lngStr !== null ? parseFloat(lngStr) : null;

    try {
      if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
        const units = await getMockUnitsWithDistance(lat, lng);
        return json({ ok: true, data: units });
      } else {
        // No coords — return all units sorted by unit_code, distance = 0
        const data = await getMockData();
        const units: MockUnitWithDistance[] = data.units
          .map((u) => ({ ...u, distance_km: 0, eta_minutes: 0 }))
          .sort((a, b) => a.unit_code.localeCompare(b.unit_code));
        return json({ ok: true, data: units });
      }
    } catch (err) {
      return jsonError(err, 500);
    }
  }

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
