/**
 * libSQL singleton client + typed query helpers.
 *
 * Default mode: embedded file (file:./data/rapidresponse.db)
 * Optional:     networked sqld (http://localhost:8080)
 *
 * Uses @libsql/client — works identically for both URL schemes.
 * Never use string interpolation in SQL; always parameterized queries.
 */

import { createClient, type Client, type InStatement } from "@libsql/client";
import { env } from "../config/env.ts";
import type {
  Incident,
  CreateIncidentInput,
  UpdateIncidentInput,
  TranscriptionTurn,
  CreateTranscriptionTurnInput,
  Unit,
  Dispatch,
  CreateDispatchInput,
  UnitStatus,
} from "../types/index.ts";

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _client: Client | null = null;

export function getDb(): Client {
  if (!_client) {
    _client = createClient({
      url: env.LIBSQL_URL,
      authToken: env.LIBSQL_AUTH_TOKEN,
    });
  }
  return _client;
}

/** Close the connection. Mainly used in tests. */
export async function closeDb(): Promise<void> {
  if (_client) {
    _client.close();
    _client = null;
  }
}

// ---------------------------------------------------------------------------
// Incident helpers
// ---------------------------------------------------------------------------

export async function dbCreateIncident(
  db: Client,
  input: CreateIncidentInput
): Promise<Incident> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO incidents
            (id, caller_id, caller_location, caller_address, status, type, priority, summary,
             created_at, updated_at, resolved_at, s3_audio_prefix, s3_transcript_key)
          VALUES (:id, :caller_id, :caller_location, :caller_address, 'active', NULL, NULL, NULL,
                  :created_at, :updated_at, NULL, NULL, NULL)`,
    args: {
      id,
      caller_id: input.caller_id,
      caller_location: input.caller_location,
      caller_address: input.caller_address,
      created_at: now,
      updated_at: now,
    },
  });

  const row = await dbGetIncident(db, id);
  if (!row) throw new Error(`Failed to create incident: ${id}`);
  return row;
}

export async function dbGetIncident(
  db: Client,
  id: string
): Promise<Incident | null> {
  const result = await db.execute({
    sql: "SELECT * FROM incidents WHERE id = :id",
    args: { id },
  });
  const row = result.rows[0];
  if (!row) return null;
  return rowToIncident(row);
}

export async function dbListIncidents(
  db: Client,
  opts: { status?: string; limit?: number; offset?: number } = {}
): Promise<Incident[]> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  let stmt: InStatement;
  if (opts.status) {
    stmt = {
      sql: "SELECT * FROM incidents WHERE status = :status ORDER BY created_at DESC LIMIT :limit OFFSET :offset",
      args: { status: opts.status, limit, offset },
    };
  } else {
    stmt = {
      sql: "SELECT * FROM incidents ORDER BY created_at DESC LIMIT :limit OFFSET :offset",
      args: { limit, offset },
    };
  }

  const result = await db.execute(stmt);
  return result.rows.map(rowToIncident);
}

export async function dbUpdateIncident(
  db: Client,
  id: string,
  input: UpdateIncidentInput
): Promise<Incident | null> {
  const now = new Date().toISOString();
  const fields: string[] = ["updated_at = :updated_at"];
  const args: Record<string, string | null> = { id, updated_at: now };

  if (input.status !== undefined) {
    fields.push("status = :status");
    args["status"] = input.status;
  }
  if (input.type !== undefined) {
    fields.push("type = :type");
    args["type"] = input.type;
  }
  if (input.priority !== undefined) {
    fields.push("priority = :priority");
    args["priority"] = input.priority;
  }
  if (input.summary !== undefined) {
    fields.push("summary = :summary");
    args["summary"] = input.summary;
  }
  if (input.resolved_at !== undefined) {
    fields.push("resolved_at = :resolved_at");
    args["resolved_at"] = input.resolved_at;
  }
  if (input.s3_audio_prefix !== undefined) {
    fields.push("s3_audio_prefix = :s3_audio_prefix");
    args["s3_audio_prefix"] = input.s3_audio_prefix;
  }
  if (input.s3_transcript_key !== undefined) {
    fields.push("s3_transcript_key = :s3_transcript_key");
    args["s3_transcript_key"] = input.s3_transcript_key;
  }

  await db.execute({
    sql: `UPDATE incidents SET ${fields.join(", ")} WHERE id = :id`,
    args,
  });

  return dbGetIncident(db, id);
}

// ---------------------------------------------------------------------------
// Transcription helpers
// ---------------------------------------------------------------------------

export async function dbCreateTranscriptionTurn(
  db: Client,
  input: CreateTranscriptionTurnInput
): Promise<TranscriptionTurn> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO transcription_turns (id, incident_id, role, text, timestamp_ms, created_at)
          VALUES (:id, :incident_id, :role, :text, :timestamp_ms, :created_at)`,
    args: {
      id,
      incident_id: input.incident_id,
      role: input.role,
      text: input.text,
      timestamp_ms: input.timestamp_ms,
      created_at: now,
    },
  });

  return { id, ...input, created_at: now };
}

export async function dbGetTranscription(
  db: Client,
  incident_id: string
): Promise<TranscriptionTurn[]> {
  const result = await db.execute({
    sql: "SELECT * FROM transcription_turns WHERE incident_id = :incident_id ORDER BY timestamp_ms ASC",
    args: { incident_id },
  });
  return result.rows.map(rowToTranscriptionTurn);
}

// ---------------------------------------------------------------------------
// Unit helpers
// ---------------------------------------------------------------------------

export async function dbListUnits(
  db: Client,
  opts: { status?: UnitStatus; type?: string } = {}
): Promise<Unit[]> {
  let stmt: InStatement;
  if (opts.status && opts.type) {
    stmt = {
      sql: "SELECT * FROM units WHERE status = :status AND type = :type ORDER BY unit_code",
      args: { status: opts.status, type: opts.type },
    };
  } else if (opts.status) {
    stmt = {
      sql: "SELECT * FROM units WHERE status = :status ORDER BY unit_code",
      args: { status: opts.status },
    };
  } else if (opts.type) {
    stmt = {
      sql: "SELECT * FROM units WHERE type = :type ORDER BY unit_code",
      args: { type: opts.type },
    };
  } else {
    stmt = { sql: "SELECT * FROM units ORDER BY unit_code", args: {} };
  }

  const result = await db.execute(stmt);
  return result.rows.map(rowToUnit);
}

export async function dbGetUnit(
  db: Client,
  id: string
): Promise<Unit | null> {
  const result = await db.execute({
    sql: "SELECT * FROM units WHERE id = :id",
    args: { id },
  });
  const row = result.rows[0];
  if (!row) return null;
  return rowToUnit(row);
}

export async function dbCreateUnit(
  db: Client,
  unit: Omit<Unit, "id" | "created_at" | "updated_at">
): Promise<Unit> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO units (id, unit_code, type, status, current_incident_id, created_at, updated_at)
          VALUES (:id, :unit_code, :type, :status, :current_incident_id, :created_at, :updated_at)`,
    args: {
      id,
      unit_code: unit.unit_code,
      type: unit.type,
      status: unit.status,
      current_incident_id: unit.current_incident_id,
      created_at: now,
      updated_at: now,
    },
  });

  return { id, ...unit, created_at: now, updated_at: now };
}

export async function dbUpdateUnitStatus(
  db: Client,
  unit_id: string,
  status: UnitStatus,
  current_incident_id: string | null
): Promise<void> {
  const now = new Date().toISOString();
  await db.execute({
    sql: "UPDATE units SET status = :status, current_incident_id = :current_incident_id, updated_at = :updated_at WHERE id = :id",
    args: { status, current_incident_id, updated_at: now, id: unit_id },
  });
}

// ---------------------------------------------------------------------------
// Dispatch helpers
// ---------------------------------------------------------------------------

export async function dbCreateDispatch(
  db: Client,
  input: CreateDispatchInput
): Promise<Dispatch> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO dispatches (id, incident_id, unit_id, dispatched_at, arrived_at, cleared_at)
          VALUES (:id, :incident_id, :unit_id, :dispatched_at, NULL, NULL)`,
    args: {
      id,
      incident_id: input.incident_id,
      unit_id: input.unit_id,
      dispatched_at: now,
    },
  });

  return {
    id,
    incident_id: input.incident_id,
    unit_id: input.unit_id,
    dispatched_at: now,
    arrived_at: null,
    cleared_at: null,
  };
}

export async function dbGetDispatchesForIncident(
  db: Client,
  incident_id: string
): Promise<Dispatch[]> {
  const result = await db.execute({
    sql: "SELECT * FROM dispatches WHERE incident_id = :incident_id ORDER BY dispatched_at ASC",
    args: { incident_id },
  });
  return result.rows.map(rowToDispatch);
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToIncident(row: Record<string, unknown>): Incident {
  return {
    id: row["id"] as string,
    caller_id: row["caller_id"] as string,
    caller_location: row["caller_location"] as string,
    caller_address: (row["caller_address"] as string) ?? "",
    status: row["status"] as Incident["status"],
    type: (row["type"] as Incident["type"]) ?? null,
    priority: (row["priority"] as Incident["priority"]) ?? null,
    summary: (row["summary"] as string) ?? null,
    created_at: row["created_at"] as string,
    updated_at: row["updated_at"] as string,
    resolved_at: (row["resolved_at"] as string) ?? null,
    s3_audio_prefix: (row["s3_audio_prefix"] as string) ?? null,
    s3_transcript_key: (row["s3_transcript_key"] as string) ?? null,
  };
}

function rowToTranscriptionTurn(row: Record<string, unknown>): TranscriptionTurn {
  return {
    id: row["id"] as string,
    incident_id: row["incident_id"] as string,
    role: row["role"] as TranscriptionTurn["role"],
    text: row["text"] as string,
    timestamp_ms: row["timestamp_ms"] as number,
    created_at: row["created_at"] as string,
  };
}

function rowToUnit(row: Record<string, unknown>): Unit {
  return {
    id: row["id"] as string,
    unit_code: row["unit_code"] as string,
    type: row["type"] as Unit["type"],
    status: row["status"] as Unit["status"],
    current_incident_id: (row["current_incident_id"] as string) ?? null,
    created_at: row["created_at"] as string,
    updated_at: row["updated_at"] as string,
  };
}

function rowToDispatch(row: Record<string, unknown>): Dispatch {
  return {
    id: row["id"] as string,
    incident_id: row["incident_id"] as string,
    unit_id: row["unit_id"] as string,
    dispatched_at: row["dispatched_at"] as string,
    arrived_at: (row["arrived_at"] as string) ?? null,
    cleared_at: (row["cleared_at"] as string) ?? null,
  };
}
