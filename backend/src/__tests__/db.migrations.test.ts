/**
 * Tests for:
 * - DB migration runner (applies SQL migrations in order, skips applied)
 * - libSQL helpers (CRUD operations against in-memory DB)
 *
 * Uses in-memory libSQL — no file system, no external services required.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  dbCreateIncident,
  dbGetIncident,
  dbListIncidents,
  dbUpdateIncident,
  dbCreateTranscriptionTurn,
  dbGetTranscription,
  dbCreateUnit,
  dbListUnits,
  dbUpdateUnitStatus,
  dbCreateDispatch,
  dbGetDispatchesForIncident,
} from "../db/libsql.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = resolve(
  import.meta.dir,
  "../db/migrations"
);

async function applyMigrations(db: Client): Promise<void> {
  // Ensure schema_migrations table exists
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const migrationFiles = [
    "001_initial.sql",
    "002_add_indexes.sql",
    "003_add_caller_address.sql",
    "004_dispatch_tables.sql",
    "005_fix_units_fk.sql",
    "006_fix_transcription_dispatches_fk.sql",
    "007_add_cad_number.sql",
    "008_add_covert_distress.sql",
    "009_roles.sql",
  ];

  for (const file of migrationFiles) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf-8");
    await db.executeMultiple(sql);
  }
}

function makeDb(): Client {
  return createClient({ url: ":memory:" });
}

// ---------------------------------------------------------------------------
// Migration tests
// ---------------------------------------------------------------------------

describe("DB Migrations", () => {
  let db: Client;

  beforeEach(async () => {
    db = makeDb();
    await applyMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates the incidents table", async () => {
    const result = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='incidents'"
    );
    expect(result.rows).toHaveLength(1);
  });

  it("creates the transcription_turns table", async () => {
    const result = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='transcription_turns'"
    );
    expect(result.rows).toHaveLength(1);
  });

  it("creates the units table", async () => {
    const result = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='units'"
    );
    expect(result.rows).toHaveLength(1);
  });

  it("creates the dispatches table", async () => {
    const result = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='dispatches'"
    );
    expect(result.rows).toHaveLength(1);
  });

  it("creates the schema_migrations table", async () => {
    const result = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
    );
    expect(result.rows).toHaveLength(1);
  });

  it("creates indexes for incidents status", async () => {
    // migration 002 creates idx_incidents_status, but migration 004 drops+recreates
    // the incidents table, which removes the old index. Migration 004 creates
    // idx_incidents_status_v2 as the replacement.
    const result = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_incidents_status_v2'"
    );
    expect(result.rows).toHaveLength(1);
  });

  it("enforces incident status CHECK constraint", async () => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await expect(
      db.execute({
        sql: `INSERT INTO incidents (id, caller_id, caller_location, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [id, "caller1", "123 Main St", "invalid_status", now, now],
      })
    ).rejects.toThrow();
  });

  it("enforces incident priority CHECK constraint", async () => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await expect(
      db.execute({
        sql: `INSERT INTO incidents (id, caller_id, caller_location, status, priority, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [id, "caller1", "123 Main St", "active", "P9", now, now],
      })
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// libSQL helper tests — Incident
// ---------------------------------------------------------------------------

describe("libSQL — Incident CRUD", () => {
  let db: Client;

  beforeEach(async () => {
    db = makeDb();
    await applyMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates an incident and retrieves it", async () => {
    const incident = await dbCreateIncident(db, {
      caller_id: "caller-001",
      caller_location: "456 Oak Ave",
    });

    expect(incident.id).toBeString();
    expect(incident.caller_id).toBe("caller-001");
    expect(incident.caller_location).toBe("456 Oak Ave");
    expect(incident.status).toBe("active");
    expect(incident.type).toBeNull();
    expect(incident.priority).toBeNull();
  });

  it("returns null for missing incident", async () => {
    const result = await dbGetIncident(db, "non-existent-id");
    expect(result).toBeNull();
  });

  it("lists incidents with pagination", async () => {
    await dbCreateIncident(db, { caller_id: "c1", caller_location: "loc1" });
    await dbCreateIncident(db, { caller_id: "c2", caller_location: "loc2" });
    await dbCreateIncident(db, { caller_id: "c3", caller_location: "loc3" });

    const page1 = await dbListIncidents(db, { limit: 2, offset: 0 });
    expect(page1).toHaveLength(2);

    const page2 = await dbListIncidents(db, { limit: 2, offset: 2 });
    expect(page2).toHaveLength(1);
  });

  it("filters incidents by status", async () => {
    const i1 = await dbCreateIncident(db, { caller_id: "c1", caller_location: "loc1" });
    await dbUpdateIncident(db, i1.id, { status: "resolved" });

    const active = await dbListIncidents(db, { status: "active" });
    const resolved = await dbListIncidents(db, { status: "resolved" });

    expect(active).toHaveLength(0);
    expect(resolved).toHaveLength(1);
  });

  it("updates incident type and priority", async () => {
    const incident = await dbCreateIncident(db, {
      caller_id: "c1",
      caller_location: "loc1",
    });

    const updated = await dbUpdateIncident(db, incident.id, {
      type: "fire",
      priority: "P1",
      status: "dispatched",
    });

    expect(updated?.type).toBe("fire");
    expect(updated?.priority).toBe("P1");
    expect(updated?.status).toBe("dispatched");
  });
});

// ---------------------------------------------------------------------------
// libSQL helper tests — Transcription
// ---------------------------------------------------------------------------

describe("libSQL — Transcription CRUD", () => {
  let db: Client;

  beforeEach(async () => {
    db = makeDb();
    await applyMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates transcription turns and retrieves them in order", async () => {
    const incident = await dbCreateIncident(db, {
      caller_id: "c1",
      caller_location: "loc1",
    });

    await dbCreateTranscriptionTurn(db, {
      incident_id: incident.id,
      role: "agent",
      text: "911, what is your emergency?",
      timestamp_ms: 0,
    });

    await dbCreateTranscriptionTurn(db, {
      incident_id: incident.id,
      role: "caller",
      text: "There is a fire at my house!",
      timestamp_ms: 3000,
    });

    const turns = await dbGetTranscription(db, incident.id);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.role).toBe("agent");
    expect(turns[1]?.role).toBe("caller");
    expect(turns[0]?.timestamp_ms).toBeLessThan(turns[1]?.timestamp_ms ?? Infinity);
  });
});

// ---------------------------------------------------------------------------
// libSQL helper tests — Units & Dispatch
// ---------------------------------------------------------------------------

describe("libSQL — Units and Dispatch", () => {
  let db: Client;

  beforeEach(async () => {
    db = makeDb();
    await applyMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates units and lists by status", async () => {
    await dbCreateUnit(db, {
      unit_code: "EMS-1",
      type: "ems",
      status: "available",
      current_incident_id: null,
    });
    await dbCreateUnit(db, {
      unit_code: "FD-1",
      type: "fire",
      status: "available",
      current_incident_id: null,
    });

    const all = await dbListUnits(db);
    expect(all).toHaveLength(2);

    const ems = await dbListUnits(db, { type: "ems" });
    expect(ems).toHaveLength(1);
    expect(ems[0]?.unit_code).toBe("EMS-1");
  });

  it("updates unit status", async () => {
    const unit = await dbCreateUnit(db, {
      unit_code: "PD-1",
      type: "police",
      status: "available",
      current_incident_id: null,
    });

    const incident = await dbCreateIncident(db, {
      caller_id: "c1",
      caller_location: "loc1",
    });

    await dbUpdateUnitStatus(db, unit.id, "dispatched", incident.id);

    const units = await dbListUnits(db, { status: "dispatched" });
    expect(units).toHaveLength(1);
    expect(units[0]?.current_incident_id).toBe(incident.id);
  });

  it("creates a dispatch record", async () => {
    const unit = await dbCreateUnit(db, {
      unit_code: "EMS-3",
      type: "ems",
      status: "available",
      current_incident_id: null,
    });

    const incident = await dbCreateIncident(db, {
      caller_id: "c1",
      caller_location: "loc1",
    });

    const dispatch = await dbCreateDispatch(db, {
      incident_id: incident.id,
      unit_id: unit.id,
    });

    expect(dispatch.incident_id).toBe(incident.id);
    expect(dispatch.unit_id).toBe(unit.id);
    expect(dispatch.arrived_at).toBeNull();

    const dispatches = await dbGetDispatchesForIncident(db, incident.id);
    expect(dispatches).toHaveLength(1);
  });
});
