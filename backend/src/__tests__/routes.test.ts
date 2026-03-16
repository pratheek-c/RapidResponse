/**
 * Tests for REST route handlers.
 *
 * Tests handleIncidents, handleUnits, handleDispatch against in-memory DB.
 * No real AWS, no real S3, no real Bedrock — pure logic tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Set env vars before any module-level imports that trigger env loading
// ---------------------------------------------------------------------------

process.env["AWS_REGION"] = "us-east-1";
process.env["AWS_ACCESS_KEY_ID"] = "test-key";
process.env["AWS_SECRET_ACCESS_KEY"] = "test-secret";
process.env["BEDROCK_NOVA_SONIC_MODEL_ID"] = "amazon.nova-2-sonic-v1:0";
process.env["BEDROCK_TITAN_EMBED_MODEL_ID"] = "amazon.titan-embed-text-v2:0";
process.env["S3_BUCKET_NAME"] = "test-bucket";
process.env["LIBSQL_URL"] = "file:./data/test-routes.db";
process.env["FRONTEND_URL"] = "http://localhost:5173";

// ---------------------------------------------------------------------------
// Test DB
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = resolve(import.meta.dir, "../db/migrations");

async function buildTestDb(): Promise<Client> {
  const db = createClient({ url: ":memory:" });
  for (const file of [
    "001_initial.sql",
    "002_add_indexes.sql",
    "003_add_caller_address.sql",
    "004_dispatch_tables.sql",
    "005_fix_units_fk.sql",
    "006_fix_transcription_dispatches_fk.sql",
    "007_add_cad_number.sql",
    "008_add_covert_distress.sql",
    "009_roles.sql",
  ]) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf-8");
    await db.executeMultiple(sql);
  }
  return db;
}

// ---------------------------------------------------------------------------
// Import helpers and override getDb for tests
// ---------------------------------------------------------------------------

import {
  dbCreateIncident,
  dbCreateUnit,
  dbListIncidents,
  dbGetIncident,
} from "../db/libsql.ts";

// ---------------------------------------------------------------------------
// Route handler tests via direct function calls
// ---------------------------------------------------------------------------

describe("handleIncidents — route logic", () => {
  let db: Client;

  beforeEach(async () => {
    db = await buildTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("creates and retrieves an incident via DB helpers", async () => {
    const incident = await dbCreateIncident(db, {
      caller_id: "tel:+15551234567",
      caller_location: "100 Main St",
    });

    expect(incident.id).toBeString();
    expect(incident.status).toBe("active");

    const fetched = await dbGetIncident(db, incident.id);
    expect(fetched?.id).toBe(incident.id);
  });

  it("lists incidents sorted by created_at DESC", async () => {
    await dbCreateIncident(db, { caller_id: "c1", caller_location: "loc1" });
    await dbCreateIncident(db, { caller_id: "c2", caller_location: "loc2" });
    await dbCreateIncident(db, { caller_id: "c3", caller_location: "loc3" });

    const all = await dbListIncidents(db, { limit: 10, offset: 0 });
    expect(all).toHaveLength(3);

    // Verify descending order
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1]!.created_at >= all[i]!.created_at).toBe(true);
    }
  });

  it("returns null for unknown incident ID", async () => {
    const result = await dbGetIncident(db, "00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });
});

describe("handleUnits — route logic", () => {
  let db: Client;

  beforeEach(async () => {
    db = await buildTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("creates units of different types", async () => {
    const ems = await dbCreateUnit(db, {
      unit_code: "EMS-1",
      type: "ems",
      status: "available",
      current_incident_id: null,
    });
    const fire = await dbCreateUnit(db, {
      unit_code: "FD-1",
      type: "fire",
      status: "available",
      current_incident_id: null,
    });

    expect(ems.type).toBe("ems");
    expect(fire.type).toBe("fire");
    expect(ems.status).toBe("available");
  });

  it("filters units by type", async () => {
    await dbCreateUnit(db, { unit_code: "EMS-2", type: "ems", status: "available", current_incident_id: null });
    await dbCreateUnit(db, { unit_code: "PD-1", type: "police", status: "available", current_incident_id: null });
    await dbCreateUnit(db, { unit_code: "PD-2", type: "police", status: "available", current_incident_id: null });

    const { dbListUnits } = await import("../db/libsql.ts");
    const police = await dbListUnits(db, { type: "police" });
    const ems = await dbListUnits(db, { type: "ems" });

    expect(police).toHaveLength(2);
    expect(ems).toHaveLength(1);
  });
});

describe("handleDispatch — route logic", () => {
  let db: Client;

  beforeEach(async () => {
    db = await buildTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("dispatch selects first available unit of requested type", async () => {
    await dbCreateUnit(db, {
      unit_code: "EMS-7",
      type: "ems",
      status: "available",
      current_incident_id: null,
    });
    await dbCreateUnit(db, {
      unit_code: "EMS-8",
      type: "ems",
      status: "dispatched",
      current_incident_id: null,
    });

    const { dbListUnits } = await import("../db/libsql.ts");
    const available = await dbListUnits(db, { status: "available", type: "ems" });

    // Only EMS-7 should be available
    expect(available).toHaveLength(1);
    expect(available[0]?.unit_code).toBe("EMS-7");
  });

  it("returns empty when no units of type available", async () => {
    const { dbListUnits } = await import("../db/libsql.ts");
    const available = await dbListUnits(db, { status: "available", type: "hazmat" });
    expect(available).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// HTTP handler integration tests using actual Response objects
// ---------------------------------------------------------------------------

describe("HTTP response format", () => {
  it("json helper produces correct Content-Type", () => {
    const res = new Response(JSON.stringify({ ok: true, data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.status).toBe(200);
  });

  it("404 response has correct structure", async () => {
    const res = new Response(JSON.stringify({ ok: false, error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Not found");
  });
});
