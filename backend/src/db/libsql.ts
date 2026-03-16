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
  DispatchAction,
  CreateDispatchActionInput,
  IncidentUnit,
  CreateIncidentUnitInput,
  DispatchQuestion,
  CreateDispatchQuestionInput,
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

  // Generate CAD number: INC-YYYYMMDD-NNNN (sequential per day)
  const today = now.slice(0, 10).replace(/-/g, ""); // "YYYYMMDD"
  const countResult = await db.execute({
    sql: "SELECT COUNT(*) as cnt FROM incidents WHERE DATE(created_at) = DATE('now')",
    args: {},
  });
  const todayCount = Number((countResult.rows[0] as Record<string, unknown>)["cnt"] ?? 0);
  const seq = (todayCount + 1).toString().padStart(4, "0");
  const cad_number = `INC-${today}-${seq}`;

  await db.execute({
    sql: `INSERT INTO incidents
            (id, cad_number, caller_id, caller_location, caller_address, status, type, priority, summary,
             created_at, updated_at, resolved_at, s3_audio_prefix, s3_transcript_key)
          VALUES (:id, :cad_number, :caller_id, :caller_location, :caller_address, 'active', NULL, NULL, NULL,
                  :created_at, :updated_at, NULL, NULL, NULL)`,
    args: {
      id,
      cad_number,
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
  const args: Record<string, string | number | null> = { id, updated_at: now };

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
  if (input.accepted_at !== undefined) {
    fields.push("accepted_at = :accepted_at");
    args["accepted_at"] = input.accepted_at;
  }
  if (input.completed_at !== undefined) {
    fields.push("completed_at = :completed_at");
    args["completed_at"] = input.completed_at;
  }
  if (input.escalated !== undefined) {
    fields.push("escalated = :escalated");
    args["escalated"] = input.escalated;
  }
  if (input.covert_distress !== undefined) {
    fields.push("covert_distress = :covert_distress");
    args["covert_distress"] = input.covert_distress;
  }
  if (input.officer_id !== undefined) {
    fields.push("officer_id = :officer_id");
    args["officer_id"] = input.officer_id;
  }
  if (input.assigned_units !== undefined) {
    fields.push("assigned_units = :assigned_units");
    args["assigned_units"] = input.assigned_units;
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
    cad_number: (row["cad_number"] as string) ?? null,
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
    accepted_at: (row["accepted_at"] as string) ?? null,
    completed_at: (row["completed_at"] as string) ?? null,
    escalated: (row["escalated"] as number) ?? 0,
    covert_distress: Number(row["covert_distress"] ?? 0),
    officer_id: (row["officer_id"] as string) ?? null,
    assigned_units: (row["assigned_units"] as string) ?? null,
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

// ---------------------------------------------------------------------------
// Dispatch action helpers
// ---------------------------------------------------------------------------

export async function dbCreateDispatchAction(
  db: Client,
  input: CreateDispatchActionInput
): Promise<DispatchAction> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const payload = input.payload ? JSON.stringify(input.payload) : null;

  await db.execute({
    sql: `INSERT INTO dispatch_actions (id, incident_id, action_type, officer_id, payload, created_at)
          VALUES (:id, :incident_id, :action_type, :officer_id, :payload, :created_at)`,
    args: {
      id,
      incident_id: input.incident_id,
      action_type: input.action_type,
      officer_id: input.officer_id ?? null,
      payload,
      created_at: now,
    },
  });

  return {
    id,
    incident_id: input.incident_id,
    action_type: input.action_type,
    officer_id: input.officer_id ?? null,
    payload,
    created_at: now,
  };
}

export async function dbGetDispatchActions(
  db: Client,
  incident_id: string
): Promise<DispatchAction[]> {
  const result = await db.execute({
    sql: "SELECT * FROM dispatch_actions WHERE incident_id = :incident_id ORDER BY created_at ASC",
    args: { incident_id },
  });
  return result.rows.map(rowToDispatchAction);
}

// ---------------------------------------------------------------------------
// Incident unit helpers
// ---------------------------------------------------------------------------

export async function dbCreateIncidentUnit(
  db: Client,
  input: CreateIncidentUnitInput
): Promise<IncidentUnit> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO incident_units (id, incident_id, unit_id, unit_type, status, dispatched_at, arrived_at)
          VALUES (:id, :incident_id, :unit_id, :unit_type, 'dispatched', :dispatched_at, NULL)`,
    args: {
      id,
      incident_id: input.incident_id,
      unit_id: input.unit_id,
      unit_type: input.unit_type,
      dispatched_at: now,
    },
  });

  return {
    id,
    incident_id: input.incident_id,
    unit_id: input.unit_id,
    unit_type: input.unit_type,
    status: "dispatched",
    dispatched_at: now,
    arrived_at: null,
  };
}

export async function dbListIncidentUnits(
  db: Client,
  incident_id: string
): Promise<IncidentUnit[]> {
  const result = await db.execute({
    sql: "SELECT * FROM incident_units WHERE incident_id = :incident_id ORDER BY dispatched_at ASC",
    args: { incident_id },
  });
  return result.rows.map(rowToIncidentUnit);
}

// ---------------------------------------------------------------------------
// Dispatch question helpers
// ---------------------------------------------------------------------------

export async function dbCreateDispatchQuestion(
  db: Client,
  input: CreateDispatchQuestionInput
): Promise<DispatchQuestion> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO dispatch_questions
            (id, incident_id, officer_id, question, refined_question, answer, asked_at, answered_at)
          VALUES
            (:id, :incident_id, :officer_id, :question, :refined_question, NULL, :asked_at, NULL)`,
    args: {
      id,
      incident_id: input.incident_id,
      officer_id: input.officer_id ?? null,
      question: input.question,
      refined_question: input.refined_question ?? null,
      asked_at: now,
    },
  });

  return {
    id,
    incident_id: input.incident_id,
    officer_id: input.officer_id ?? null,
    question: input.question,
    refined_question: input.refined_question ?? null,
    answer: null,
    asked_at: now,
    answered_at: null,
  };
}

export async function dbUpdateDispatchQuestion(
  db: Client,
  id: string,
  answer: string
): Promise<void> {
  const now = new Date().toISOString();
  await db.execute({
    sql: "UPDATE dispatch_questions SET answer = :answer, answered_at = :answered_at WHERE id = :id",
    args: { answer, answered_at: now, id },
  });
}

export async function dbGetDispatchQuestions(
  db: Client,
  incident_id: string
): Promise<DispatchQuestion[]> {
  const result = await db.execute({
    sql: "SELECT * FROM dispatch_questions WHERE incident_id = :incident_id ORDER BY asked_at ASC",
    args: { incident_id },
  });
  return result.rows.map(rowToDispatchQuestion);
}

// ---------------------------------------------------------------------------
// New row mappers
// ---------------------------------------------------------------------------

function rowToDispatchAction(row: Record<string, unknown>): DispatchAction {
  return {
    id: row["id"] as string,
    incident_id: row["incident_id"] as string,
    action_type: row["action_type"] as DispatchAction["action_type"],
    officer_id: (row["officer_id"] as string) ?? null,
    payload: (row["payload"] as string) ?? null,
    created_at: row["created_at"] as string,
  };
}

function rowToIncidentUnit(row: Record<string, unknown>): IncidentUnit {
  return {
    id: row["id"] as string,
    incident_id: row["incident_id"] as string,
    unit_id: row["unit_id"] as string,
    unit_type: row["unit_type"] as IncidentUnit["unit_type"],
    status: row["status"] as IncidentUnit["status"],
    dispatched_at: row["dispatched_at"] as string,
    arrived_at: (row["arrived_at"] as string) ?? null,
  };
}

function rowToDispatchQuestion(row: Record<string, unknown>): DispatchQuestion {
  return {
    id: row["id"] as string,
    incident_id: row["incident_id"] as string,
    officer_id: (row["officer_id"] as string) ?? null,
    question: row["question"] as string,
    refined_question: (row["refined_question"] as string) ?? null,
    answer: (row["answer"] as string) ?? null,
    asked_at: row["asked_at"] as string,
    answered_at: (row["answered_at"] as string) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Backup requests
// ---------------------------------------------------------------------------

export async function dbCreateBackupRequest(
  db: Client,
  input: {
    incident_id: string;
    requesting_unit: string;
    requested_types: string[];
    urgency: "routine" | "urgent" | "emergency";
    message?: string;
    alerted_units: string[];
  }
): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO backup_requests
          (id, incident_id, requesting_unit, requested_types, urgency, message, alerted_units, responded_units)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.incident_id,
      input.requesting_unit,
      JSON.stringify(input.requested_types),
      input.urgency,
      input.message ?? null,
      JSON.stringify(input.alerted_units),
      JSON.stringify([]),
    ],
  });
  return { id };
}

export async function dbAddBackupResponder(
  db: Client,
  backupRequestId: string,
  respondingUnit: string
): Promise<void> {
  const row = await db.execute({
    sql: "SELECT responded_units FROM backup_requests WHERE id = ?",
    args: [backupRequestId],
  });
  const existing: string[] = row.rows[0]
    ? JSON.parse((row.rows[0].responded_units as string) ?? "[]")
    : [];
  if (!existing.includes(respondingUnit)) existing.push(respondingUnit);
  await db.execute({
    sql: "UPDATE backup_requests SET responded_units = ? WHERE id = ?",
    args: [JSON.stringify(existing), backupRequestId],
  });
}

export async function dbGetOpenBackupRequestForIncident(
  db: Client,
  incidentId: string
): Promise<{ id: string } | null> {
  const row = await db.execute({
    sql: "SELECT id FROM backup_requests WHERE incident_id = ? ORDER BY created_at DESC LIMIT 1",
    args: [incidentId],
  });
  if (!row.rows[0]) return null;
  return { id: row.rows[0].id as string };
}
