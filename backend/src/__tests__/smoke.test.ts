/**
 * Smoke tests — full-stack HTTP + WebSocket + SSE.
 *
 * Spins up the real Bun.serve() server against an in-memory libSQL DB with
 * all 9 migrations applied. AWS services are mocked at module level so no
 * real credentials are required.
 *
 * Coverage:
 *   GET  /health
 *   GET  /events             (SSE connection + ping frame)
 *   GET/PATCH /incidents/*
 *   GET/POST/PATCH /units/*
 *   POST/GET/PATCH /dispatch/*
 *   WS   /call               (call_start → call_accepted → call_end → call_ended)
 *   SSE event emission       (incident_created, unit_dispatched, status_change, etc.)
 */

// ---------------------------------------------------------------------------
// Env vars — must be set before any module that reads env is imported
// ---------------------------------------------------------------------------

process.env["AWS_REGION"] = "us-east-1";
process.env["AWS_ACCESS_KEY_ID"] = "smoke-key";
process.env["AWS_SECRET_ACCESS_KEY"] = "smoke-secret";
process.env["BEDROCK_NOVA_SONIC_MODEL_ID"] = "amazon.nova-2-sonic-v1:0";
process.env["BEDROCK_TITAN_EMBED_MODEL_ID"] = "amazon.titan-embed-text-v2:0";
process.env["S3_BUCKET_NAME"] = "smoke-bucket";
process.env["LIBSQL_URL"] = ":memory:"; // used by fallback only
process.env["FRONTEND_URL"] = "http://localhost:5173";
process.env["PORT"] = "0"; // Bun assigns a free port
process.env["DISPATCH_CITY"] = "SmokeCity";
process.env["DISPATCH_DEPT"] = "SmokeCity Emergency";
process.env["LANCEDB_PATH"] = "./data/lancedb-smoke-" + crypto.randomUUID();

// ---------------------------------------------------------------------------
// Shared DB cell — set before server starts so mock getDb returns test DB
// ---------------------------------------------------------------------------

import { mock } from "bun:test";
import { createClient, type Client } from "@libsql/client";

// Cell to hold the test DB instance — updated in beforeAll
let _testDb: Client | null = null;

// ---------------------------------------------------------------------------
// libsql mock — intercepts getDb() for all route handlers
// Must be registered before importing server.ts or any route file
// ---------------------------------------------------------------------------

mock.module("../db/libsql.ts", () => {
  // Re-import all real helpers at mock-factory time via dynamic import is
  // not possible synchronously, so we duplicate the getDb override only and
  // re-export everything else from the real module path.
  //
  // Strategy: return a live proxy so that getDb() returns _testDb when set.
  // All other named exports (dbCreateIncident, dbGetIncident, etc.) are
  // provided by the real module — we load them via require-style in Bun.
  //
  // Bun resolves mock.module paths relative to the test file.
  // The real module file is at ../db/libsql.ts relative to __tests__/.

  // We need all real exports too (test code calls them with explicit db param).
  // Since we can't do async here, we import from the actual file path.
  // In Bun mock factories, `require` is available for synchronous loads.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const real = require("../db/libsql.ts") as Record<string, unknown>;

  return {
    ...real,
    getDb: () => {
      if (!_testDb) throw new Error("smoke test: _testDb not initialized");
      return _testDb;
    },
    closeDb: async () => {
      // no-op in smoke tests — we close the db in afterAll ourselves
    },
  };
});

// ---------------------------------------------------------------------------
// AWS module mocks — hoisted before any import that pulls in the SDK
// ---------------------------------------------------------------------------

// Mock BedrockRuntimeClient — used by novaAgent, reportAgent, dispatchBridgeAgent
mock.module("@aws-sdk/client-bedrock-runtime", () => {
  class FakeBedrockClient {
    send(_cmd: unknown): Promise<unknown> {
      // Minimal Nova Lite response shape for InvokeModelCommand
      const mockBody = new TextEncoder().encode(
        JSON.stringify({ content: [{ type: "text", text: "Mock AI response" }] })
      );
      return Promise.resolve({ body: mockBody });
    }
    destroy(): void {}
  }
  return {
    BedrockRuntimeClient: FakeBedrockClient,
    InvokeModelWithBidirectionalStreamCommand: class {},
    InvokeModelCommand: class {},
    ConverseCommand: class {},
  };
});

// Mock S3 — used by storageService
mock.module("@aws-sdk/client-s3", () => {
  class FakeS3Client {
    send(_cmd: unknown): Promise<unknown> {
      return Promise.resolve({ Body: undefined });
    }
    destroy(): void {}
  }
  return {
    S3Client: FakeS3Client,
    PutObjectCommand: class {},
    GetObjectCommand: class {},
    HeadObjectCommand: class {},
  };
});

// Mock presigner — used by storageService
mock.module("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (_client: unknown, _cmd: unknown) =>
    Promise.resolve("https://mock-presigned-url/recording"),
}));

// Mock LanceDB — ragService only; not needed for smoke
mock.module("@lancedb/lancedb", () => ({
  connect: (_path: unknown) =>
    Promise.resolve({
      openTable: (_name: unknown) => Promise.resolve({ search: () => ({ limit: () => ({ toArray: () => Promise.resolve([]) }) }) }),
      createTable: (_name: unknown, _data: unknown) => Promise.resolve({}),
      tableNames: () => Promise.resolve([]),
    }),
}));

// ---------------------------------------------------------------------------
// Real imports (after mocks are registered)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  dbCreateIncident,
  dbCreateUnit,
  dbUpdateIncident,
  dbCreateDispatch,
  dbGetIncident,
  dbCreateBackupRequest,
} from "../db/libsql.ts";

// ---------------------------------------------------------------------------
// In-memory DB helpers
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = resolve(import.meta.dir, "../db/migrations");
const ALL_MIGRATIONS = [
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

async function buildTestDb(): Promise<Client> {
  const db = createClient({ url: ":memory:" });
  for (const file of ALL_MIGRATIONS) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf-8");
    await db.executeMultiple(sql);
  }
  return db;
}

// ---------------------------------------------------------------------------
// DB cleanup helper — deletes all tables in FK-safe order
// ---------------------------------------------------------------------------

async function cleanDb(client: Client): Promise<void> {
  // Delete child tables first, then parents.
  // FK graph:
  //   transcription_turns  → incidents
  //   dispatches           → incidents, units
  //   dispatch_actions     → incidents
  //   incident_units       → incidents
  //   dispatch_questions   → incidents
  //   backup_requests      → incidents
  //   units.current_incident_id → incidents  (so units must go before incidents)
  await client.execute("DELETE FROM transcription_turns");
  await client.execute("DELETE FROM dispatches");
  await client.execute("DELETE FROM dispatch_actions");
  await client.execute("DELETE FROM incident_units");
  await client.execute("DELETE FROM dispatch_questions");
  await client.execute("DELETE FROM backup_requests");
  await client.execute("DELETE FROM active_sessions");
  // units.current_incident_id → incidents: must delete units before incidents
  await client.execute("DELETE FROM units");
  await client.execute("DELETE FROM incidents");
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedIncident(
  db: Client,
  overrides: Partial<{ caller_id: string; caller_location: string }> = {}
): Promise<{ id: string; cad_number: string | null }> {
  return dbCreateIncident(db, {
    caller_id: overrides.caller_id ?? "smoke-caller",
    caller_location: overrides.caller_location ?? "37.7749,-122.4194",
  });
}

async function seedUnit(
  db: Client,
  overrides: Partial<{
    unit_code: string;
    type: "fire" | "ems" | "police" | "hazmat" | "rescue";
    status: "available" | "dispatched" | "on_scene" | "returning";
  }> = {}
): Promise<{ id: string; unit_code: string }> {
  return dbCreateUnit(db, {
    unit_code: overrides.unit_code ?? "SMOKE-1",
    type: overrides.type ?? "police",
    status: overrides.status ?? "available",
    current_incident_id: null,
  });
}

// ---------------------------------------------------------------------------
// SSE event collector
// ---------------------------------------------------------------------------

type SseFrame = { type: string; data: Record<string, unknown> };

/**
 * Open an SSE connection to `url/events`, collect frames until `count` frames
 * matching `predicate` arrive or `timeoutMs` elapses.
 * Always aborts the connection before returning.
 */
async function collectSSEEvents(
  baseUrl: string,
  count: number,
  predicate: (frame: SseFrame) => boolean = () => true,
  timeoutMs = 1500
): Promise<SseFrame[]> {
  const controller = new AbortController();
  const frames: SseFrame[] = [];

  const fetchPromise = (async () => {
    const res = await fetch(`${baseUrl}/events`, { signal: controller.signal });
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // Parse SSE frames separated by double newline
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";

      for (const part of parts) {
        const lines = part.split("\n");
        let eventType = "message";
        let dataStr = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) eventType = line.slice(7).trim();
          else if (line.startsWith("data: ")) dataStr = line.slice(6).trim();
        }
        if (!dataStr) continue;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(dataStr) as Record<string, unknown>;
        } catch {
          continue;
        }
        const frame: SseFrame = { type: eventType, data: parsed };
        if (predicate(frame)) {
          frames.push(frame);
          if (frames.length >= count) {
            controller.abort();
            return;
          }
        }
      }
    }
  })();

  const timeout = new Promise<void>((resolve) =>
    setTimeout(() => {
      controller.abort();
      resolve();
    }, timeoutMs)
  );

  await Promise.race([fetchPromise.catch(() => {}), timeout]);
  return frames;
}

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

import { createServer } from "../server.ts";

type TestServer = ReturnType<typeof createServer>;

let server: TestServer;
let db: Client;
let BASE_URL: string;

beforeAll(async () => {
  db = await buildTestDb();
  _testDb = db; // set the cell before createServer so getDb() works
  server = createServer();
  // Bun assigns a random port when PORT=0; retrieve it from the server
  BASE_URL = `http://localhost:${server.port}`;
});

afterAll(async () => {
  server.stop(true);
  db.close();
  _testDb = null;
});

// ---------------------------------------------------------------------------
// Suite 1 — GET /health
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  it("returns 200 with ok:true and ISO timestamp", async () => {
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(typeof body["ts"]).toBe("string");
    expect(() => new Date(body["ts"] as string)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — GET /events (SSE)
// ---------------------------------------------------------------------------

describe("GET /events (SSE)", () => {
  it("responds with text/event-stream and correct headers", async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${BASE_URL}/events`, { signal: ctrl.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    ctrl.abort();
  });

  it("sends initial ping event on connect", async () => {
    const frames = await collectSSEEvents(
      BASE_URL,
      1,
      (f) => f.type === "ping",
      1000
    );
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames[0]?.type).toBe("ping");
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — /incidents REST
// ---------------------------------------------------------------------------

describe("/incidents REST", () => {
  beforeEach(async () => {
    await cleanDb(db);
  });

  it("GET /incidents returns empty array on fresh DB", async () => {
    const res = await fetch(`${BASE_URL}/incidents`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(Array.isArray(body["data"])).toBe(true);
    expect((body["data"] as unknown[]).length).toBe(0);
  });

  it("GET /incidents lists seeded incidents", async () => {
    await seedIncident(db, { caller_id: "c1" });
    await seedIncident(db, { caller_id: "c2" });
    const res = await fetch(`${BASE_URL}/incidents`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect((body["data"] as unknown[]).length).toBe(2);
  });

  it("GET /incidents?status=active filters correctly", async () => {
    const inc = await seedIncident(db);
    // Update one to resolved
    await dbUpdateIncident(db, inc.id, { status: "resolved" });
    await seedIncident(db, { caller_id: "still-active" });

    const res = await fetch(`${BASE_URL}/incidents?status=active`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect((body["data"] as unknown[]).length).toBe(1);
  });

  it("GET /incidents/:id returns the incident", async () => {
    const inc = await seedIncident(db);
    const res = await fetch(`${BASE_URL}/incidents/${inc.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    const data = body["data"] as Record<string, unknown>;
    expect(data["id"]).toBe(inc.id);
    expect(data["status"]).toBe("active");
    expect(data["cad_number"]).toBeString();
  });

  it("GET /incidents/:id returns 404 for unknown id", async () => {
    const res = await fetch(`${BASE_URL}/incidents/does-not-exist`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(false);
  });

  it("PATCH /incidents/:id updates status", async () => {
    const inc = await seedIncident(db);
    const res = await fetch(`${BASE_URL}/incidents/${inc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "classified", type: "fire", priority: "P2" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    const data = body["data"] as Record<string, unknown>;
    expect(data["status"]).toBe("classified");
    expect(data["type"]).toBe("fire");
    expect(data["priority"]).toBe("P2");
  });

  it("GET /incidents/resolved returns resolved and completed incidents", async () => {
    const i1 = await seedIncident(db);
    const i2 = await seedIncident(db, { caller_id: "c2" });
    const i3 = await seedIncident(db, { caller_id: "c3" });
    await dbUpdateIncident(db, i1.id, { status: "resolved" });
    await dbUpdateIncident(db, i2.id, { status: "completed" });
    // i3 stays active
    void i3;

    const res = await fetch(`${BASE_URL}/incidents/resolved`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect((body["data"] as unknown[]).length).toBe(2);
  });

  it("GET /incidents/:id/transcript returns empty array", async () => {
    const inc = await seedIncident(db);
    const res = await fetch(`${BASE_URL}/incidents/${inc.id}/transcript`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Array.isArray(body["data"])).toBe(true);
  });

  it("GET /incidents/:id/actions returns empty array", async () => {
    const inc = await seedIncident(db);
    const res = await fetch(`${BASE_URL}/incidents/${inc.id}/actions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Array.isArray(body["data"])).toBe(true);
  });

  it("GET /incidents/:id/questions returns empty array", async () => {
    const inc = await seedIncident(db);
    const res = await fetch(`${BASE_URL}/incidents/${inc.id}/questions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Array.isArray(body["data"])).toBe(true);
  });

  it("GET /incidents/:id/units returns empty array", async () => {
    const inc = await seedIncident(db);
    const res = await fetch(`${BASE_URL}/incidents/${inc.id}/units`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Array.isArray(body["data"])).toBe(true);
  });

  it("DELETE /incidents returns 405", async () => {
    const res = await fetch(`${BASE_URL}/incidents`, { method: "DELETE" });
    expect(res.status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — /units REST
// ---------------------------------------------------------------------------

describe("/units REST", () => {
  beforeEach(async () => {
    await cleanDb(db);
  });

  it("GET /units returns empty array on fresh DB", async () => {
    const res = await fetch(`${BASE_URL}/units`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(Array.isArray(body["data"])).toBe(true);
    expect((body["data"] as unknown[]).length).toBe(0);
  });

  it("POST /units creates a unit and returns 201", async () => {
    const res = await fetch(`${BASE_URL}/units`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unit_code: "PD-1", type: "police", status: "available" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    const data = body["data"] as Record<string, unknown>;
    expect(data["unit_code"]).toBe("PD-1");
    expect(data["type"]).toBe("police");
    expect(data["status"]).toBe("available");
    expect(typeof data["id"]).toBe("string");
  });

  it("GET /units lists created units", async () => {
    await seedUnit(db, { unit_code: "EMS-1", type: "ems" });
    await seedUnit(db, { unit_code: "FD-1", type: "fire" });
    const res = await fetch(`${BASE_URL}/units`);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body["data"] as unknown[]).length).toBe(2);
  });

  it("GET /units?type=ems filters by type", async () => {
    await seedUnit(db, { unit_code: "EMS-2", type: "ems" });
    await seedUnit(db, { unit_code: "PD-2", type: "police" });
    const res = await fetch(`${BASE_URL}/units?type=ems`);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body["data"] as unknown[]).length).toBe(1);
    const first = (body["data"] as Array<Record<string, unknown>>)[0]!;
    expect(first["type"]).toBe("ems");
  });

  it("GET /units?status=available filters by status", async () => {
    await seedUnit(db, { unit_code: "PD-3", status: "available" });
    await seedUnit(db, { unit_code: "PD-4", status: "dispatched" });
    const res = await fetch(`${BASE_URL}/units?status=available`);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body["data"] as unknown[]).length).toBe(1);
  });

  it("GET /units/:id returns the unit", async () => {
    const unit = await seedUnit(db, { unit_code: "HZ-1", type: "hazmat" });
    const res = await fetch(`${BASE_URL}/units/${unit.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const data = body["data"] as Record<string, unknown>;
    expect(data["id"]).toBe(unit.id);
    expect(data["unit_code"]).toBe("HZ-1");
  });

  it("GET /units/:id returns 404 for unknown id", async () => {
    const res = await fetch(`${BASE_URL}/units/no-such-unit`);
    expect(res.status).toBe(404);
  });

  it("PATCH /units/:id updates status", async () => {
    const unit = await seedUnit(db, { unit_code: "RS-1", type: "rescue" });
    const res = await fetch(`${BASE_URL}/units/${unit.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "on_scene" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const data = body["data"] as Record<string, unknown>;
    expect(data["status"]).toBe("on_scene");
  });

  it("DELETE /units returns 405", async () => {
    const res = await fetch(`${BASE_URL}/units`, { method: "DELETE" });
    expect(res.status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// Suite 5 — /dispatch REST
// ---------------------------------------------------------------------------

describe("/dispatch REST", () => {
  beforeEach(async () => {
    await cleanDb(db);
  });

  it("POST /dispatch — manual dispatch returns 201 with dispatch result", async () => {
    const inc = await seedIncident(db);
    const unit = await seedUnit(db, { unit_code: "PD-10", type: "police" });

    const res = await fetch(`${BASE_URL}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incident_id: inc.id, unit_type: "police" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    const data = body["data"] as Record<string, unknown>;
    expect((data["unit"] as Record<string, unknown>)["id"]).toBe(unit.id);
    expect((data["dispatch"] as Record<string, unknown>)["incident_id"]).toBe(inc.id);
  });

  it("POST /dispatch — returns error when no available unit of type", async () => {
    const inc = await seedIncident(db);
    // No EMS unit seeded
    const res = await fetch(`${BASE_URL}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incident_id: inc.id, unit_type: "ems" }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(false);
  });

  it("GET /dispatch/:incident_id returns dispatches", async () => {
    const inc = await seedIncident(db);
    const unit = await seedUnit(db, { unit_code: "EMS-20", type: "ems" });
    await dbCreateDispatch(db, { incident_id: inc.id, unit_id: unit.id });

    const res = await fetch(`${BASE_URL}/dispatch/${inc.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect((body["data"] as unknown[]).length).toBe(1);
  });

  it("PATCH /dispatch/:id/arrive marks unit arrived", async () => {
    const inc = await seedIncident(db);
    const unit = await seedUnit(db, { unit_code: "FD-30", type: "fire" });
    const dispatch = await dbCreateDispatch(db, {
      incident_id: inc.id,
      unit_id: unit.id,
    });

    const res = await fetch(`${BASE_URL}/dispatch/${dispatch.id}/arrive`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unit_id: unit.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body["data"] as Record<string, unknown>)["arrived"]).toBe(true);
  });

  it("PATCH /dispatch/:id/clear marks unit cleared", async () => {
    const inc = await seedIncident(db);
    const unit = await seedUnit(db, { unit_code: "HZ-40", type: "hazmat" });
    const dispatch = await dbCreateDispatch(db, {
      incident_id: inc.id,
      unit_id: unit.id,
    });

    const res = await fetch(`${BASE_URL}/dispatch/${dispatch.id}/clear`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unit_id: unit.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body["data"] as Record<string, unknown>)["cleared"]).toBe(true);
  });

  it("POST /dispatch/accept returns 201 with AcceptResult shape", async () => {
    const inc = await seedIncident(db);
    const unit = await seedUnit(db, { unit_code: "PD-50", type: "police" });

    const res = await fetch(`${BASE_URL}/dispatch/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: inc.id,
        unit_ids: [unit.id],
        officer_id: "officer-1",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    const data = body["data"] as Record<string, unknown>;
    expect(data["incident_id"]).toBe(inc.id);
    expect(data["officer_id"]).toBe("officer-1");
    expect(Array.isArray(data["units"])).toBe(true);
    expect(data["status"]).toBe("dispatched");
  });

  it("POST /dispatch/escalate returns 200 with EscalateResult shape", async () => {
    const inc = await seedIncident(db);

    const res = await fetch(`${BASE_URL}/dispatch/escalate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: inc.id,
        reason: "Situation worsening",
        requested_unit_types: ["fire", "medical"],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    const data = body["data"] as Record<string, unknown>;
    expect(data["incident_id"]).toBe(inc.id);
    expect(data["status"]).toBe("en_route");
    expect(Array.isArray(data["requested_unit_types"])).toBe(true);
  });

  it("POST /dispatch/complete marks incident completed", async () => {
    const inc = await seedIncident(db);

    const res = await fetch(`${BASE_URL}/dispatch/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incident_id: inc.id, officer_notes: "All clear" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    const data = body["data"] as Record<string, unknown>;
    expect(data["incident_id"]).toBe(inc.id);
    expect(data["status"]).toBe("completed");
  });

  it("POST /dispatch/save-report saves summary and returns it (mocked AI)", async () => {
    const inc = await seedIncident(db);

    const res = await fetch(`${BASE_URL}/dispatch/save-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incident_id: inc.id, summary: "Smoke test summary" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    const data = body["data"] as Record<string, unknown>;
    expect(data["incident_id"]).toBe(inc.id);
    expect(typeof data["summary"]).toBe("string");
  });

  it("POST /dispatch/question saves question and returns it", async () => {
    const inc = await seedIncident(db);

    const res = await fetch(`${BASE_URL}/dispatch/question`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: inc.id,
        question: "Is the caller safe right now?",
        officer_id: "officer-2",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    const data = body["data"] as Record<string, unknown>;
    expect(data["incident_id"]).toBe(inc.id);
    expect(data["question"]).toBe("Is the caller safe right now?");
  });

  it("POST /dispatch/take — unit_officer role self-assigns to incident", async () => {
    const inc = await seedIncident(db);
    const unit = await seedUnit(db, { unit_code: "PD-60", type: "police" });

    const res = await fetch(`${BASE_URL}/dispatch/take`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: inc.id,
        unit_id: unit.id,
        role: "unit_officer",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    const data = body["data"] as Record<string, unknown>;
    expect(data["status"]).toBe("dispatched");
    expect(typeof data["dispatch_message"]).toBe("string");
  });

  it("POST /dispatch/take — dispatcher role returns 403", async () => {
    const inc = await seedIncident(db);
    const unit = await seedUnit(db, { unit_code: "PD-61", type: "police" });

    const res = await fetch(`${BASE_URL}/dispatch/take`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: inc.id,
        unit_id: unit.id,
        role: "dispatcher", // wrong role
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(false);
  });

  it("POST /dispatch/backup-request — unit_officer requests backup and gets 201", async () => {
    const inc = await seedIncident(db);
    const requestingUnit = await seedUnit(db, { unit_code: "PD-70", type: "police" });
    // Assign requesting unit to incident first
    await dbUpdateIncident(db, inc.id, {
      assigned_units: JSON.stringify([requestingUnit.id]),
    });

    const res = await fetch(`${BASE_URL}/dispatch/backup-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: inc.id,
        requesting_unit: requestingUnit.id,
        requested_types: ["medical"],
        urgency: "urgent",
        role: "unit_officer",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    const data = body["data"] as Record<string, unknown>;
    expect(data["status"]).toBe("alert_sent");
    expect(Array.isArray(data["alerted_units"])).toBe(true);
  });

  it("POST /dispatch/backup-respond — unit_officer responds to backup and gets 201", async () => {
    const inc = await seedIncident(db);
    const requestingUnit = await seedUnit(db, { unit_code: "PD-80", type: "police" });
    const respondingUnit = await seedUnit(db, { unit_code: "EMS-80", type: "ems" });

    // Assign requesting unit and create a backup request
    await dbUpdateIncident(db, inc.id, {
      assigned_units: JSON.stringify([requestingUnit.id]),
    });
    await dbCreateBackupRequest(db, {
      incident_id: inc.id,
      requesting_unit: requestingUnit.id,
      requested_types: ["medical"],
      urgency: "urgent",
      alerted_units: [respondingUnit.id],
    });

    const res = await fetch(`${BASE_URL}/dispatch/backup-respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: inc.id,
        responding_unit: respondingUnit.id,
        role: "unit_officer",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    const data = body["data"] as Record<string, unknown>;
    expect(data["status"]).toBe("responding");
    expect(data["incident_id"]).toBe(inc.id);
  });
});

// ---------------------------------------------------------------------------
// Suite 6 — SSE event emission (integration)
// ---------------------------------------------------------------------------

describe("SSE event emission", () => {
  beforeEach(async () => {
    await cleanDb(db);
  });

  it("POST /dispatch emits unit_dispatched SSE event", async () => {
    const inc = await seedIncident(db);
    await seedUnit(db, { unit_code: "SSE-PD-1", type: "police" });

    const framesPromise = collectSSEEvents(
      BASE_URL,
      1,
      (f) => f.type === "unit_dispatched",
      2000
    );

    // Small delay to ensure SSE connection is established
    await new Promise((r) => setTimeout(r, 100));

    await fetch(`${BASE_URL}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incident_id: inc.id, unit_type: "police" }),
    });

    const frames = await framesPromise;
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames[0]?.type).toBe("unit_dispatched");
  });

  it("POST /dispatch/accept emits status_change SSE event", async () => {
    const inc = await seedIncident(db);
    const unit = await seedUnit(db, { unit_code: "SSE-PD-2", type: "police" });

    const framesPromise = collectSSEEvents(
      BASE_URL,
      1,
      (f) => f.type === "status_change",
      2000
    );

    await new Promise((r) => setTimeout(r, 100));

    await fetch(`${BASE_URL}/dispatch/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: inc.id,
        unit_ids: [unit.id],
        officer_id: "officer-sse",
      }),
    });

    const frames = await framesPromise;
    expect(frames.length).toBeGreaterThanOrEqual(1);
    const statusFrame = frames.find((f) => f.type === "status_change");
    expect(statusFrame).toBeDefined();
    expect((statusFrame!.data as Record<string, unknown>)["incident_id"]).toBe(inc.id);
  });

  it("POST /dispatch/escalate emits status_change with en_route", async () => {
    const inc = await seedIncident(db);

    const framesPromise = collectSSEEvents(
      BASE_URL,
      1,
      (f) =>
        f.type === "status_change" &&
        (f.data as Record<string, unknown>)["status"] === "en_route",
      2000
    );

    await new Promise((r) => setTimeout(r, 100));

    await fetch(`${BASE_URL}/dispatch/escalate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: inc.id,
        reason: "Active fire spreading",
        requested_unit_types: ["fire"],
      }),
    });

    const frames = await framesPromise;
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect((frames[0]!.data as Record<string, unknown>)["status"]).toBe("en_route");
  });

  it("POST /dispatch/complete emits status_change with completed", async () => {
    const inc = await seedIncident(db);

    const framesPromise = collectSSEEvents(
      BASE_URL,
      1,
      (f) =>
        f.type === "status_change" &&
        (f.data as Record<string, unknown>)["status"] === "completed",
      2000
    );

    await new Promise((r) => setTimeout(r, 100));

    await fetch(`${BASE_URL}/dispatch/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incident_id: inc.id }),
    });

    const frames = await framesPromise;
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect((frames[0]!.data as Record<string, unknown>)["status"]).toBe("completed");
  });

  it("POST /dispatch/backup-request emits backup_requested SSE event", async () => {
    const inc = await seedIncident(db);
    const unit = await seedUnit(db, { unit_code: "SSE-PD-3", type: "police" });
    await dbUpdateIncident(db, inc.id, {
      assigned_units: JSON.stringify([unit.id]),
    });

    const framesPromise = collectSSEEvents(
      BASE_URL,
      1,
      (f) => f.type === "backup_requested",
      2000
    );

    await new Promise((r) => setTimeout(r, 100));

    await fetch(`${BASE_URL}/dispatch/backup-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: inc.id,
        requesting_unit: unit.id,
        requested_types: ["fire"],
        urgency: "emergency",
        role: "unit_officer",
      }),
    });

    const frames = await framesPromise;
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames[0]?.type).toBe("backup_requested");
  });

  it("POST /dispatch/backup-respond emits backup_accepted SSE event", async () => {
    const inc = await seedIncident(db);
    const requestingUnit = await seedUnit(db, { unit_code: "SSE-PD-4", type: "police" });
    const respondingUnit = await seedUnit(db, { unit_code: "SSE-EMS-1", type: "ems" });
    await dbUpdateIncident(db, inc.id, {
      assigned_units: JSON.stringify([requestingUnit.id]),
    });
    await dbCreateBackupRequest(db, {
      incident_id: inc.id,
      requesting_unit: requestingUnit.id,
      requested_types: ["medical"],
      urgency: "urgent",
      alerted_units: [respondingUnit.id],
    });

    const framesPromise = collectSSEEvents(
      BASE_URL,
      1,
      (f) => f.type === "backup_accepted",
      2000
    );

    await new Promise((r) => setTimeout(r, 100));

    await fetch(`${BASE_URL}/dispatch/backup-respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: inc.id,
        responding_unit: respondingUnit.id,
        role: "unit_officer",
      }),
    });

    const frames = await framesPromise;
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames[0]?.type).toBe("backup_accepted");
  });
});

// ---------------------------------------------------------------------------
// Suite 7 — WebSocket /call smoke
// ---------------------------------------------------------------------------

describe("WebSocket /call smoke", () => {
  beforeEach(async () => {
    await cleanDb(db);
  });

  it("full call lifecycle: call_start → call_accepted → call_end → call_ended", async () => {
    const WS_URL = `ws://localhost:${server.port}/call`;
    const received: Array<Record<string, unknown>> = [];

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("WebSocket smoke test timed out"));
      }, 5000);

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "call_start",
            caller_id: "smoke-ws-caller",
            location: "37.7749,-122.4194",
            address: "123 Smoke Test Ave",
          })
        );
      };

      ws.onmessage = (event) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(event.data as string) as Record<string, unknown>;
        } catch {
          return;
        }
        received.push(msg);

        if (msg["type"] === "call_accepted") {
          // Send a fake audio chunk then end the call
          ws.send(
            JSON.stringify({
              type: "audio_chunk",
              data: Buffer.alloc(640).toString("base64"),
            })
          );
          setTimeout(() => {
            ws.send(JSON.stringify({ type: "call_end" }));
          }, 100);
        }

        if (msg["type"] === "call_ended") {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      };

      ws.onerror = (err) => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket error: ${JSON.stringify(err)}`));
      };
    });

    // Verify message sequence
    const types = received.map((m) => m["type"]);
    expect(types).toContain("call_accepted");
    expect(types).toContain("call_ended");

    // call_accepted must arrive before call_ended
    const acceptIdx = types.indexOf("call_accepted");
    const endedIdx = types.indexOf("call_ended");
    expect(acceptIdx).toBeLessThan(endedIdx);
  });

  it("incident is created in DB after call_start + call_accepted", async () => {
    const WS_URL = `ws://localhost:${server.port}/call`;
    let incidentId: string | undefined;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Timed out waiting for call_accepted"));
      }, 5000);

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "call_start",
            caller_id: "smoke-ws-db-check",
            location: "40.7128,-74.0060",
          })
        );
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string) as Record<string, unknown>;
        if (msg["type"] === "call_accepted") {
          incidentId = msg["incident_id"] as string;
          clearTimeout(timeout);
          ws.send(JSON.stringify({ type: "call_end" }));
        }
        if (msg["type"] === "call_ended") {
          ws.close();
          resolve();
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("WebSocket error"));
      };
    });

    expect(incidentId).toBeString();
    const incident = await dbGetIncident(db, incidentId!);
    expect(incident).not.toBeNull();
    expect(incident?.caller_id).toBe("smoke-ws-db-check");
  });

  it("SSE incident_created fires when WS call_start is received", async () => {
    const WS_URL = `ws://localhost:${server.port}/call`;

    // Start SSE listener first
    const framesPromise = collectSSEEvents(
      BASE_URL,
      1,
      (f) => f.type === "incident_created",
      4000
    );

    // Small delay to ensure SSE connection established
    await new Promise((r) => setTimeout(r, 150));

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Timed out waiting for call_accepted for SSE test"));
      }, 5000);

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "call_start",
            caller_id: "smoke-ws-sse",
            location: "51.5074,-0.1278",
          })
        );
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string) as Record<string, unknown>;
        if (msg["type"] === "call_accepted") {
          clearTimeout(timeout);
          ws.send(JSON.stringify({ type: "call_end" }));
        }
        if (msg["type"] === "call_ended") {
          ws.close();
          resolve();
        }
      };
      ws.onerror = () => { clearTimeout(timeout); reject(new Error("WS error")); };
    });

    const frames = await framesPromise;
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames[0]?.type).toBe("incident_created");
  });
});
