/**
 * Tests for incidentService, transcriptionService, and dispatchService.
 *
 * Uses in-memory libSQL. Overrides getDb() singleton via module-level
 * injection so services use the test DB.
 *
 * No AWS credentials required.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Test DB setup
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = resolve(import.meta.dir, "../db/migrations");

async function buildTestDb(): Promise<Client> {
  const db = createClient({ url: ":memory:" });
  for (const file of ["001_initial.sql", "002_add_indexes.sql"]) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf-8");
    await db.executeMultiple(sql);
  }
  return db;
}

// ---------------------------------------------------------------------------
// Import DB helpers directly (bypass singleton getDb)
// ---------------------------------------------------------------------------

import {
  dbCreateIncident,
  dbGetIncident,
  dbListIncidents,
  dbUpdateIncident,
  dbCreateTranscriptionTurn,
  dbGetTranscription,
  dbCreateUnit,
  dbListUnits,
  dbCreateDispatch,
  dbGetDispatchesForIncident,
  dbUpdateUnitStatus,
} from "../db/libsql.ts";

// ---------------------------------------------------------------------------
// incidentService tests (direct DB helper layer)
// ---------------------------------------------------------------------------

describe("incidentService — DB layer", () => {
  let db: Client;

  beforeEach(async () => {
    db = await buildTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("creates an incident with active status", async () => {
    const incident = await dbCreateIncident(db, {
      caller_id: "tel:+15551234567",
      caller_location: "123 Elm St",
    });
    expect(incident.status).toBe("active");
    expect(incident.type).toBeNull();
    expect(incident.priority).toBeNull();
  });

  it("classifies an incident (update type + priority)", async () => {
    const incident = await dbCreateIncident(db, {
      caller_id: "c1",
      caller_location: "loc1",
    });
    const updated = await dbUpdateIncident(db, incident.id, {
      type: "medical",
      priority: "P1",
    });
    expect(updated?.type).toBe("medical");
    expect(updated?.priority).toBe("P1");
  });

  it("resolves an incident", async () => {
    const incident = await dbCreateIncident(db, {
      caller_id: "c1",
      caller_location: "loc1",
    });
    const resolved = await dbUpdateIncident(db, incident.id, {
      status: "resolved",
      summary: "Caller reported chest pain. EMS dispatched.",
      resolved_at: new Date().toISOString(),
    });
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.summary).toBe("Caller reported chest pain. EMS dispatched.");
    expect(resolved?.resolved_at).not.toBeNull();
  });

  it("lists only active incidents", async () => {
    const i1 = await dbCreateIncident(db, { caller_id: "c1", caller_location: "loc1" });
    const i2 = await dbCreateIncident(db, { caller_id: "c2", caller_location: "loc2" });
    await dbUpdateIncident(db, i2.id, { status: "resolved" });

    const active = await dbListIncidents(db, { status: "active" });
    expect(active.map((i) => i.id)).toContain(i1.id);
    expect(active.map((i) => i.id)).not.toContain(i2.id);
  });
});

// ---------------------------------------------------------------------------
// transcriptionService tests
// ---------------------------------------------------------------------------

describe("transcriptionService — DB layer", () => {
  let db: Client;

  beforeEach(async () => {
    db = await buildTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("saves and retrieves transcription turns in order", async () => {
    const incident = await dbCreateIncident(db, {
      caller_id: "c1",
      caller_location: "loc1",
    });

    await dbCreateTranscriptionTurn(db, {
      incident_id: incident.id,
      role: "agent",
      text: "911 Emergency, what is your emergency?",
      timestamp_ms: 0,
    });
    await dbCreateTranscriptionTurn(db, {
      incident_id: incident.id,
      role: "caller",
      text: "My house is on fire!",
      timestamp_ms: 2500,
    });
    await dbCreateTranscriptionTurn(db, {
      incident_id: incident.id,
      role: "agent",
      text: "I'm dispatching fire services now. Are you safe?",
      timestamp_ms: 4000,
    });

    const turns = await dbGetTranscription(db, incident.id);
    expect(turns).toHaveLength(3);
    expect(turns[0]?.role).toBe("agent");
    expect(turns[1]?.role).toBe("caller");
    expect(turns[2]?.role).toBe("agent");

    // Verify chronological order
    for (let i = 1; i < turns.length; i++) {
      expect(turns[i]!.timestamp_ms).toBeGreaterThan(turns[i - 1]!.timestamp_ms);
    }
  });

  it("returns empty array for unknown incident", async () => {
    const turns = await dbGetTranscription(db, "non-existent-id");
    expect(turns).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// dispatchService tests
// ---------------------------------------------------------------------------

describe("dispatchService — DB layer", () => {
  let db: Client;

  beforeEach(async () => {
    db = await buildTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("dispatches an available unit to an incident", async () => {
    const incident = await dbCreateIncident(db, {
      caller_id: "c1",
      caller_location: "loc1",
    });
    const unit = await dbCreateUnit(db, {
      unit_code: "EMS-5",
      type: "ems",
      status: "available",
      current_incident_id: null,
    });

    const dispatch = await dbCreateDispatch(db, {
      incident_id: incident.id,
      unit_id: unit.id,
    });

    await dbUpdateUnitStatus(db, unit.id, "dispatched", incident.id);
    await dbUpdateIncident(db, incident.id, { status: "dispatched" });

    const dispatches = await dbGetDispatchesForIncident(db, incident.id);
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.unit_id).toBe(unit.id);
    expect(dispatches[0]?.arrived_at).toBeNull();

    const units = await dbListUnits(db, { status: "dispatched" });
    expect(units[0]?.current_incident_id).toBe(incident.id);

    const updated = await dbGetIncident(db, incident.id);
    expect(updated?.status).toBe("dispatched");
  });

  it("marks unit as arrived and clears it", async () => {
    const incident = await dbCreateIncident(db, {
      caller_id: "c1",
      caller_location: "loc1",
    });
    const unit = await dbCreateUnit(db, {
      unit_code: "FD-2",
      type: "fire",
      status: "available",
      current_incident_id: null,
    });

    const dispatch = await dbCreateDispatch(db, {
      incident_id: incident.id,
      unit_id: unit.id,
    });

    // Arrive
    await db.execute({
      sql: "UPDATE dispatches SET arrived_at = :arrived_at WHERE id = :id",
      args: { arrived_at: new Date().toISOString(), id: dispatch.id },
    });
    await dbUpdateUnitStatus(db, unit.id, "on_scene", incident.id);

    const arrivedUnits = await dbListUnits(db, { status: "on_scene" });
    expect(arrivedUnits).toHaveLength(1);

    // Clear
    await db.execute({
      sql: "UPDATE dispatches SET cleared_at = :cleared_at WHERE id = :id",
      args: { cleared_at: new Date().toISOString(), id: dispatch.id },
    });
    await dbUpdateUnitStatus(db, unit.id, "available", null);

    const clearedUnits = await dbListUnits(db, { status: "available" });
    expect(clearedUnits).toHaveLength(1);
    expect(clearedUnits[0]?.current_incident_id).toBeNull();
  });

  it("fails gracefully when no unit of type is available", async () => {
    const available = await dbListUnits(db, {
      status: "available",
      type: "hazmat",
    });
    // No hazmat units seeded — should return empty
    expect(available).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// storageService tests (mock S3)
// ---------------------------------------------------------------------------

describe("storageService — key builders", () => {
  // Set the minimal env vars required by storageService key builders
  // before importing the module so the lazy env proxy doesn't throw.
  beforeEach(() => {
    process.env["AWS_REGION"] = "us-east-1";
    process.env["AWS_ACCESS_KEY_ID"] = "test-key";
    process.env["AWS_SECRET_ACCESS_KEY"] = "test-secret";
    process.env["BEDROCK_NOVA_SONIC_MODEL_ID"] = "amazon.nova-2-sonic-v1:0";
    process.env["BEDROCK_TITAN_EMBED_MODEL_ID"] = "amazon.titan-embed-text-v2:0";
    process.env["S3_BUCKET_NAME"] = "test-bucket";
    process.env["S3_RECORDINGS_PREFIX"] = "recordings/";
  });

  it("builds correct audio chunk key", async () => {
    const { audioChunkKey } = await import("../services/storageService.ts");
    const key = audioChunkKey("incident-abc", 1700000000000);
    expect(key).toContain("incident-abc");
    expect(key).toContain("audio_1700000000000");
    expect(key).toMatch(/\.webm$/);
  });

  it("builds correct transcript key", async () => {
    const { transcriptKey } = await import("../services/storageService.ts");
    const key = transcriptKey("incident-xyz");
    expect(key).toContain("incident-xyz");
    expect(key).toContain("transcript.json");
  });
});
