/**
 * Demo seed script — Dublin Emergency Services.
 *
 * Populates the database with realistic Dublin-based demo incidents, units,
 * dispatch actions, questions, and transcript turns for demonstration purposes.
 * Emergency number: 112 (Ireland).
 *
 * Usage:
 *   bun backend/scripts/seedDemo.ts
 *
 * Safe to run multiple times — clears all data first and reinserts.
 */

import { createClient } from "@libsql/client";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const MIGRATIONS_DIR = resolve(import.meta.dir, "../src/db/migrations");

const MIGRATION_FILES = [
  "001_initial.sql",
  "002_add_indexes.sql",
  "003_add_caller_address.sql",
  "004_dispatch_tables.sql",
  "005_fix_units_fk.sql",
  "006_fix_transcription_dispatches_fk.sql",
];

// ---------------------------------------------------------------------------
// DB connection — read LIBSQL_URL from env or fall back to local file
// ---------------------------------------------------------------------------

const LIBSQL_URL = process.env["LIBSQL_URL"] ?? "file:./data/rapidresponse.db";
const LIBSQL_AUTH_TOKEN = process.env["LIBSQL_AUTH_TOKEN"] ?? undefined;

const db = createClient({ url: LIBSQL_URL, authToken: LIBSQL_AUTH_TOKEN });

// ---------------------------------------------------------------------------
// Deterministic IDs (stable across seed runs)
// ---------------------------------------------------------------------------

const IDS = {
  // Units — Dublin Fire Brigade (FD), National Ambulance Service (AMB),
  //         Garda Síochána (GD), HAZMAT, Search & Rescue
  u_fire1:    "11111111-0001-0001-0001-000000000001",
  u_fire2:    "11111111-0001-0001-0001-000000000002",
  u_amb1:     "11111111-0002-0001-0001-000000000001",
  u_amb2:     "11111111-0002-0001-0001-000000000002",
  u_garda1:   "11111111-0003-0001-0001-000000000001",
  u_garda2:   "11111111-0003-0001-0001-000000000002",
  u_garda3:   "11111111-0003-0001-0001-000000000003",
  u_hazmat1:  "11111111-0004-0001-0001-000000000001",
  u_rescue1:  "11111111-0005-0001-0001-000000000001",

  // Incidents
  i_active:      "22222222-0001-0001-0001-000000000001",
  i_dispatched:  "22222222-0001-0001-0001-000000000002",
  i_on_scene:    "22222222-0001-0001-0001-000000000003",
  i_completed1:  "22222222-0001-0001-0001-000000000004",
  i_completed2:  "22222222-0001-0001-0001-000000000005",
  i_classified:  "22222222-0001-0001-0001-000000000006",

  // Dispatches
  d1: "33333333-0001-0001-0001-000000000001",
  d2: "33333333-0001-0001-0001-000000000002",
  d3: "33333333-0001-0001-0001-000000000003",

  // incident_units
  iu1: "44444444-0001-0001-0001-000000000001",
  iu2: "44444444-0001-0001-0001-000000000002",
  iu3: "44444444-0001-0001-0001-000000000003",

  // dispatch_actions
  da1: "55555555-0001-0001-0001-000000000001",
  da2: "55555555-0001-0001-0001-000000000002",
  da3: "55555555-0001-0001-0001-000000000003",
  da4: "55555555-0001-0001-0001-000000000004",

  // dispatch_questions
  dq1: "66666666-0001-0001-0001-000000000001",
  dq2: "66666666-0001-0001-0001-000000000002",
};

const NOW = new Date().toISOString();
const T = (offsetSeconds: number): string =>
  new Date(Date.now() - offsetSeconds * 1000).toISOString();

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function exec(sql: string, args: Record<string, string | number | null> = {}): Promise<void> {
  await db.execute({ sql, args });
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

async function runMigrations(): Promise<void> {
  console.log("[seed] Ensuring schema is up to date...");
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = new Set(
    (await db.execute("SELECT version FROM schema_migrations")).rows.map(
      (r) => r["version"] as string
    )
  );
  for (const file of MIGRATION_FILES) {
    const version = file.replace(".sql", "");
    if (applied.has(version)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf-8");
    await db.executeMultiple(sql);
    await db.execute({
      sql: "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      args: [version, new Date().toISOString()],
    });
    console.log(`  [migrate] Applied: ${version}`);
  }
}

// ---------------------------------------------------------------------------
// Clear existing data
// ---------------------------------------------------------------------------

async function clearData(): Promise<void> {
  console.log("[seed] Clearing existing data...");
  await db.execute("DELETE FROM dispatch_questions");
  await db.execute("DELETE FROM dispatch_actions");
  await db.execute("DELETE FROM incident_units");
  await db.execute("DELETE FROM dispatches");
  await db.execute("DELETE FROM transcription_turns");
  await db.execute("UPDATE units SET current_incident_id = NULL");
  await db.execute("DELETE FROM incidents");
  await db.execute("DELETE FROM units");
}

// ---------------------------------------------------------------------------
// 1. Units
// ---------------------------------------------------------------------------

async function seedUnits(): Promise<void> {
  console.log("[seed] Inserting units...");

  const units: Array<[string, string, string, string]> = [
    // [id, unit_code, type, status]
    [IDS.u_fire1,   "FD-1",  "fire",   "dispatched"],
    [IDS.u_fire2,   "FD-2",  "fire",   "available"],
    [IDS.u_amb1,    "AMB-1", "ems",    "on_scene"],
    [IDS.u_amb2,    "AMB-2", "ems",    "available"],
    [IDS.u_garda1,  "GD-1",  "police", "available"],
    [IDS.u_garda2,  "GD-2",  "police", "dispatched"],
    [IDS.u_garda3,  "GD-3",  "police", "available"],
    [IDS.u_hazmat1, "HZ-1",  "hazmat", "available"],
    [IDS.u_rescue1, "SAR-1", "rescue", "available"],
  ];

  for (const [id, unit_code, type, status] of units) {
    await exec(
      `INSERT OR IGNORE INTO units (id, unit_code, type, status, current_incident_id, created_at, updated_at)
       VALUES (:id, :unit_code, :type, :status, NULL, :created_at, :updated_at)`,
      { id, unit_code, type, status, created_at: T(3600), updated_at: NOW }
    );
  }
}

async function seedUnitLinks(): Promise<void> {
  console.log("[seed] Patching unit current_incident_id links...");

  const links: Array<[string, string]> = [
    [IDS.u_fire1,  IDS.i_dispatched],
    [IDS.u_garda2, IDS.i_dispatched],
    [IDS.u_amb1,   IDS.i_on_scene],
  ];

  for (const [unit_id, incident_id] of links) {
    await exec(
      `UPDATE units SET current_incident_id = :incident_id, updated_at = :updated_at
       WHERE id = :unit_id`,
      { unit_id, incident_id, updated_at: NOW }
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Incidents — Dublin locations (lat,lng)
// ---------------------------------------------------------------------------

async function seedIncidents(): Promise<void> {
  console.log("[seed] Inserting incidents...");

  type IncidentRow = {
    id: string;
    caller_id: string;
    caller_location: string;
    caller_address: string;
    status: string;
    type: string | null;
    priority: string | null;
    summary: string | null;
    created_at: string;
    updated_at: string;
    accepted_at: string | null;
    completed_at: string | null;
    escalated: number;
    officer_id: string | null;
    assigned_units: string | null;
  };

  const incidents: IncidentRow[] = [
    {
      id: IDS.i_active,
      caller_id: "caller-demo-001",
      caller_location: "53.3498,-6.2603",
      caller_address: "O'Connell Street, Dublin 1",
      status: "active",
      type: null,
      priority: null,
      summary: null,
      created_at: T(120),
      updated_at: T(60),
      accepted_at: null,
      completed_at: null,
      escalated: 0,
      officer_id: null,
      assigned_units: null,
    },
    {
      id: IDS.i_classified,
      caller_id: "caller-demo-006",
      caller_location: "53.3382,-6.2591",
      caller_address: "St. Stephen's Green, Dublin 2",
      status: "classified",
      type: "medical",
      priority: "P2",
      summary: "Caller reports a person collapsed on the footpath near St. Stephen's Green North, possibly unconscious.",
      created_at: T(480),
      updated_at: T(420),
      accepted_at: null,
      completed_at: null,
      escalated: 0,
      officer_id: null,
      assigned_units: null,
    },
    {
      id: IDS.i_dispatched,
      caller_id: "caller-demo-002",
      caller_location: "53.3461,-6.2560",
      caller_address: "Tara Street, Dublin 2",
      status: "dispatched",
      type: "fire",
      priority: "P1",
      summary: "Smoke reported from second-floor flat above a chipper on Tara Street. Building evacuation underway.",
      created_at: T(900),
      updated_at: T(600),
      accepted_at: T(750),
      completed_at: null,
      escalated: 0,
      officer_id: "officer-demo-001",
      assigned_units: JSON.stringify([IDS.u_fire1, IDS.u_garda2]),
    },
    {
      id: IDS.i_on_scene,
      caller_id: "caller-demo-003",
      caller_location: "53.3588,-6.2857",
      caller_address: "North Circular Road, Dublin 7",
      status: "on_scene",
      type: "traffic",
      priority: "P2",
      summary: "Two-vehicle collision at NCR and Phibsborough Road junction. One occupant with suspected broken arm. Ambulance on scene.",
      created_at: T(2400),
      updated_at: T(900),
      accepted_at: T(2200),
      completed_at: null,
      escalated: 0,
      officer_id: "officer-demo-002",
      assigned_units: JSON.stringify([IDS.u_amb1]),
    },
    {
      id: IDS.i_completed1,
      caller_id: "caller-demo-004",
      caller_location: "53.3457,-6.2651",
      caller_address: "Temple Bar, Dublin 2",
      status: "completed",
      type: "police",
      priority: "P3",
      summary: "Report of altercation outside a pub on Temple Bar. Garda responded, parties separated, no arrests made.",
      created_at: T(7200),
      updated_at: T(3600),
      accepted_at: T(7000),
      completed_at: T(3600),
      escalated: 0,
      officer_id: "officer-demo-001",
      assigned_units: JSON.stringify([IDS.u_garda2]),
    },
    {
      id: IDS.i_completed2,
      caller_id: "caller-demo-005",
      caller_location: "53.3659,-6.2748",
      caller_address: "Phibsborough Road, Dublin 7",
      status: "completed",
      type: "medical",
      priority: "P2",
      summary: "Caller reported elderly woman having difficulty breathing at residential address. Ambulance attended, patient stabilised and transported to Mater Hospital.",
      created_at: T(14400),
      updated_at: T(7200),
      accepted_at: T(14200),
      completed_at: T(7200),
      escalated: 0,
      officer_id: "officer-demo-002",
      assigned_units: JSON.stringify([IDS.u_amb2, IDS.u_garda1]),
    },
  ];

  for (const inc of incidents) {
    await exec(
      `INSERT OR IGNORE INTO incidents
         (id, caller_id, caller_location, caller_address,
          status, type, priority, summary,
          created_at, updated_at, resolved_at,
          s3_audio_prefix, s3_transcript_key,
          accepted_at, completed_at, escalated, officer_id, assigned_units)
       VALUES
         (:id, :caller_id, :caller_location, :caller_address,
          :status, :type, :priority, :summary,
          :created_at, :updated_at, NULL, NULL, NULL,
          :accepted_at, :completed_at, :escalated, :officer_id, :assigned_units)`,
      {
        id: inc.id,
        caller_id: inc.caller_id,
        caller_location: inc.caller_location,
        caller_address: inc.caller_address,
        status: inc.status,
        type: inc.type,
        priority: inc.priority,
        summary: inc.summary,
        created_at: inc.created_at,
        updated_at: inc.updated_at,
        accepted_at: inc.accepted_at,
        completed_at: inc.completed_at,
        escalated: inc.escalated,
        officer_id: inc.officer_id,
        assigned_units: inc.assigned_units,
      }
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Transcription turns
// ---------------------------------------------------------------------------

async function seedTranscripts(): Promise<void> {
  console.log("[seed] Inserting transcription turns...");

  const turns: Array<{ id: string; incident_id: string; role: string; text: string; timestamp_ms: number }> = [
    // Active incident — call just started, O'Connell Street
    { id: "tt-001-001", incident_id: IDS.i_active,     role: "agent",  text: "112, what's your emergency?", timestamp_ms: 500 },
    { id: "tt-001-002", incident_id: IDS.i_active,     role: "caller", text: "Hi, yes — there's a man collapsed on the footpath outside the Spire on O'Connell Street. He's not moving.", timestamp_ms: 3200 },
    { id: "tt-001-003", incident_id: IDS.i_active,     role: "agent",  text: "Okay, is he breathing?", timestamp_ms: 6100 },
    { id: "tt-001-004", incident_id: IDS.i_active,     role: "caller", text: "I can't tell — there's a crowd around him. He just fell down suddenly.", timestamp_ms: 9400 },

    // Dispatched incident — fire on Tara Street
    { id: "tt-002-001", incident_id: IDS.i_dispatched, role: "agent",  text: "112, what's your emergency?", timestamp_ms: 500 },
    { id: "tt-002-002", incident_id: IDS.i_dispatched, role: "caller", text: "There's smoke coming out of the upstairs flat on Tara Street, just beside the chipper. People are coming out of the building.", timestamp_ms: 2800 },
    { id: "tt-002-003", incident_id: IDS.i_dispatched, role: "agent",  text: "Got it. What's the exact address?", timestamp_ms: 5200 },
    { id: "tt-002-004", incident_id: IDS.i_dispatched, role: "caller", text: "It's on Tara Street, just near the DART station. The smoke is getting worse.", timestamp_ms: 8700 },
    { id: "tt-002-005", incident_id: IDS.i_dispatched, role: "agent",  text: "Dublin Fire Brigade are on their way. Please make sure everyone is out and stay well back from the building.", timestamp_ms: 12000 },

    // On-scene incident — RTC on North Circular Road
    { id: "tt-003-001", incident_id: IDS.i_on_scene,   role: "agent",  text: "112, what's your emergency?", timestamp_ms: 400 },
    { id: "tt-003-002", incident_id: IDS.i_on_scene,   role: "caller", text: "There's been a crash at the NCR junction — two cars. One driver looks injured, she's holding her arm.", timestamp_ms: 3100 },
    { id: "tt-003-003", incident_id: IDS.i_on_scene,   role: "agent",  text: "Ambulance is on the way. Is she conscious and breathing?", timestamp_ms: 6200 },
    { id: "tt-003-004", incident_id: IDS.i_on_scene,   role: "caller", text: "Yes, she's awake. She says her arm really hurts but she can breathe fine. Her name is Mary, she looks about fifty.", timestamp_ms: 10500 },
  ];

  for (const t of turns) {
    await exec(
      `INSERT OR IGNORE INTO transcription_turns (id, incident_id, role, text, timestamp_ms, created_at)
       VALUES (:id, :incident_id, :role, :text, :timestamp_ms, :created_at)`,
      { ...t, created_at: NOW }
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Dispatches
// ---------------------------------------------------------------------------

async function seedDispatches(): Promise<void> {
  console.log("[seed] Inserting dispatches...");

  const dispatches: Array<{
    id: string; incident_id: string; unit_id: string;
    dispatched_at: string; arrived_at: string | null; cleared_at: string | null;
  }> = [
    { id: IDS.d1, incident_id: IDS.i_dispatched, unit_id: IDS.u_fire1,  dispatched_at: T(750),  arrived_at: null,     cleared_at: null },
    { id: IDS.d2, incident_id: IDS.i_dispatched, unit_id: IDS.u_garda2, dispatched_at: T(720),  arrived_at: null,     cleared_at: null },
    { id: IDS.d3, incident_id: IDS.i_on_scene,   unit_id: IDS.u_amb1,   dispatched_at: T(2200), arrived_at: T(1800),  cleared_at: null },
  ];

  for (const d of dispatches) {
    await exec(
      `INSERT OR IGNORE INTO dispatches (id, incident_id, unit_id, dispatched_at, arrived_at, cleared_at)
       VALUES (:id, :incident_id, :unit_id, :dispatched_at, :arrived_at, :cleared_at)`,
      d
    );
  }
}

// ---------------------------------------------------------------------------
// 5. Incident units
// ---------------------------------------------------------------------------

async function seedIncidentUnits(): Promise<void> {
  console.log("[seed] Inserting incident_units...");

  const rows: Array<{
    id: string; incident_id: string; unit_id: string; unit_type: string;
    status: string; dispatched_at: string; arrived_at: string | null;
  }> = [
    { id: IDS.iu1, incident_id: IDS.i_dispatched, unit_id: IDS.u_fire1,  unit_type: "fire",   status: "dispatched", dispatched_at: T(750),  arrived_at: null },
    { id: IDS.iu2, incident_id: IDS.i_dispatched, unit_id: IDS.u_garda2, unit_type: "police", status: "dispatched", dispatched_at: T(720),  arrived_at: null },
    { id: IDS.iu3, incident_id: IDS.i_on_scene,   unit_id: IDS.u_amb1,   unit_type: "ems",    status: "on_scene",   dispatched_at: T(2200), arrived_at: T(1800) },
  ];

  for (const r of rows) {
    await exec(
      `INSERT OR IGNORE INTO incident_units (id, incident_id, unit_id, unit_type, status, dispatched_at, arrived_at)
       VALUES (:id, :incident_id, :unit_id, :unit_type, :status, :dispatched_at, :arrived_at)`,
      r
    );
  }
}

// ---------------------------------------------------------------------------
// 6. Dispatch actions
// ---------------------------------------------------------------------------

async function seedDispatchActions(): Promise<void> {
  console.log("[seed] Inserting dispatch_actions...");

  const rows: Array<{
    id: string; incident_id: string; action_type: string;
    officer_id: string | null; payload: string | null; created_at: string;
  }> = [
    {
      id: IDS.da1,
      incident_id: IDS.i_dispatched,
      action_type: "accept",
      officer_id: "officer-demo-001",
      payload: JSON.stringify({ unit_ids: [IDS.u_fire1, IDS.u_garda2] }),
      created_at: T(750),
    },
    {
      id: IDS.da2,
      incident_id: IDS.i_on_scene,
      action_type: "accept",
      officer_id: "officer-demo-002",
      payload: JSON.stringify({ unit_ids: [IDS.u_amb1] }),
      created_at: T(2200),
    },
    {
      id: IDS.da3,
      incident_id: IDS.i_completed1,
      action_type: "complete",
      officer_id: "officer-demo-001",
      payload: JSON.stringify({ officer_notes: "Situation de-escalated. Parties separated. No arrests." }),
      created_at: T(3600),
    },
    {
      id: IDS.da4,
      incident_id: IDS.i_completed2,
      action_type: "save_report",
      officer_id: "officer-demo-002",
      payload: JSON.stringify({ summary: "Elderly female patient transported to Mater Hospital. Condition stable." }),
      created_at: T(7200),
    },
  ];

  for (const r of rows) {
    await exec(
      `INSERT OR IGNORE INTO dispatch_actions (id, incident_id, action_type, officer_id, payload, created_at)
       VALUES (:id, :incident_id, :action_type, :officer_id, :payload, :created_at)`,
      r
    );
  }
}

// ---------------------------------------------------------------------------
// 7. Dispatch questions
// ---------------------------------------------------------------------------

async function seedDispatchQuestions(): Promise<void> {
  console.log("[seed] Inserting dispatch_questions...");

  const rows: Array<{
    id: string; incident_id: string; officer_id: string | null;
    question: string; refined_question: string | null;
    answer: string | null; asked_at: string; answered_at: string | null;
  }> = [
    {
      id: IDS.dq1,
      incident_id: IDS.i_dispatched,
      officer_id: "officer-demo-001",
      question: "Which floors are affected by smoke?",
      refined_question: "Can you see smoke coming from any floors other than the second floor?",
      answer: "Caller confirms smoke visible only from second-floor windows so far.",
      asked_at: T(700),
      answered_at: T(680),
    },
    {
      id: IDS.dq2,
      incident_id: IDS.i_on_scene,
      officer_id: "officer-demo-002",
      question: "Is the patient alert and responsive?",
      refined_question: "Is the woman awake and able to speak to you?",
      answer: "Caller confirmed patient is conscious, responsive, and able to describe her pain.",
      asked_at: T(2100),
      answered_at: T(2060),
    },
  ];

  for (const r of rows) {
    await exec(
      `INSERT OR IGNORE INTO dispatch_questions
         (id, incident_id, officer_id, question, refined_question, answer, asked_at, answered_at)
       VALUES
         (:id, :incident_id, :officer_id, :question, :refined_question, :answer, :asked_at, :answered_at)`,
      r
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`[seed] Connecting to: ${LIBSQL_URL}`);

  try {
    await runMigrations();
    await clearData();
    await seedUnits();
    await seedIncidents();
    await seedUnitLinks();
    await seedTranscripts();
    await seedDispatches();
    await seedIncidentUnits();
    await seedDispatchActions();
    await seedDispatchQuestions();

    console.log("[seed] Done. Database seeded with Dublin demo data.");
  } catch (err) {
    console.error("[seed] ERROR:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    db.close();
  }
}

await main();
