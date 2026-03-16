/**
 * Database seed script.
 *
 * Populates libSQL with sample Dublin emergency units, incidents and transcriptions.
 *
 * Usage: bun run seed
 *
 * Safe to run multiple times — clears existing seed data first.
 */

import { createClient } from "@libsql/client";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const MIGRATIONS_DIR = resolve(import.meta.dir, "../src/db/migrations");

async function getDb() {
  const url = process.env["LIBSQL_URL"] ?? "file:./data/rapidresponse.db";
  const authToken = process.env["LIBSQL_AUTH_TOKEN"];
  const db = createClient({ url, authToken });

  // Ensure schema exists
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

  for (const file of [
    "001_initial.sql",
    "002_add_indexes.sql",
    "003_add_caller_address.sql",
    "004_dispatch_tables.sql",
    "005_fix_units_fk.sql",
    "006_fix_transcription_dispatches_fk.sql",
  ]) {
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

  return db;
}

type UnitSeed = {
  unit_code: string;
  type: "fire" | "ems" | "police" | "hazmat" | "rescue";
};

// Dublin Fire Brigade (FD), National Ambulance Service (AMB),
// Garda Síochána (GD), HAZMAT and Coast Guard/Rescue
const SEED_UNITS: UnitSeed[] = [
  { unit_code: "AMB-1", type: "ems" },
  { unit_code: "AMB-2", type: "ems" },
  { unit_code: "AMB-3", type: "ems" },
  { unit_code: "AMB-4", type: "ems" },
  { unit_code: "FD-1",  type: "fire" },
  { unit_code: "FD-2",  type: "fire" },
  { unit_code: "FD-3",  type: "fire" },
  { unit_code: "FD-4",  type: "fire" },
  { unit_code: "GD-1",  type: "police" },
  { unit_code: "GD-2",  type: "police" },
  { unit_code: "GD-3",  type: "police" },
  { unit_code: "GD-4",  type: "police" },
  { unit_code: "HZ-1",  type: "hazmat" },
  { unit_code: "SAR-1", type: "rescue" },
];

async function seedUnits(db: Awaited<ReturnType<typeof getDb>>) {
  console.log("Seeding units...");

  // Clear in FK-safe order before re-inserting
  await db.execute("DELETE FROM dispatch_questions");
  await db.execute("DELETE FROM dispatch_actions");
  await db.execute("DELETE FROM incident_units");
  await db.execute("DELETE FROM dispatches");
  await db.execute("DELETE FROM transcription_turns");
  await db.execute("UPDATE units SET current_incident_id = NULL");
  await db.execute("DELETE FROM incidents");
  await db.execute("DELETE FROM units");

  const now = new Date().toISOString();

  for (const unit of SEED_UNITS) {
    const id = crypto.randomUUID();
    await db.execute({
      sql: `INSERT INTO units (id, unit_code, type, status, current_incident_id, created_at, updated_at)
            VALUES (?, ?, ?, 'available', NULL, ?, ?)`,
      args: [id, unit.unit_code, unit.type, now, now],
    });
    console.log(`  + ${unit.unit_code} (${unit.type})`);
  }

  console.log(`  Seeded ${SEED_UNITS.length} units.`);
}

type IncidentSeed = {
  caller_id: string;
  caller_location: string;
  caller_address: string;
  status: "active" | "dispatched" | "resolved";
  type: "fire" | "medical" | "police" | "traffic" | "hazmat" | "search_rescue" | "other" | null;
  priority: "P1" | "P2" | "P3" | "P4" | null;
  summary: string | null;
};

const SEED_INCIDENTS: IncidentSeed[] = [
  {
    caller_id: "tel:+353861234001",
    caller_location: "53.3461,-6.2560",
    caller_address: "Tara Street, Dublin 2",
    status: "resolved",
    type: "fire",
    priority: "P1",
    summary: "Structure fire at flat above chipper on Tara Street. Two fire units dispatched. Fire extinguished. No injuries reported.",
  },
  {
    caller_id: "tel:+353861234002",
    caller_location: "53.3498,-6.2603",
    caller_address: "O'Connell Street, Dublin 1",
    status: "dispatched",
    type: "medical",
    priority: "P1",
    summary: "Caller reported elderly male collapsed outside the GPO. AMB-1 dispatched.",
  },
  {
    caller_id: "tel:+353861234003",
    caller_location: "53.3588,-6.2857",
    caller_address: "North Circular Road, Dublin 7",
    status: "dispatched",
    type: "traffic",
    priority: "P2",
    summary: "Two-vehicle collision at junction of NCR and Phibsborough Road. Two injuries. AMB and Garda dispatched.",
  },
  {
    caller_id: "tel:+353861234004",
    caller_location: "53.3382,-6.2591",
    caller_address: "St. Stephen's Green, Dublin 2",
    status: "active",
    type: null,
    priority: null,
    summary: null,
  },
];

async function seedIncidents(db: Awaited<ReturnType<typeof getDb>>) {
  console.log("Seeding incidents...");

  const now = new Date().toISOString();
  const ids: string[] = [];

  for (const incident of SEED_INCIDENTS) {
    const id = crypto.randomUUID();
    ids.push(id);
    const resolvedAt = incident.status === "resolved" ? now : null;

    await db.execute({
      sql: `INSERT INTO incidents
              (id, caller_id, caller_location, caller_address, status, type, priority, summary,
               created_at, updated_at, resolved_at, s3_audio_prefix, s3_transcript_key)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      args: [
        id,
        incident.caller_id,
        incident.caller_location,
        incident.caller_address,
        incident.status,
        incident.type,
        incident.priority,
        incident.summary,
        now,
        now,
        resolvedAt,
      ],
    });

    console.log(`  + ${id} [${incident.status}] ${incident.type ?? "unclassified"} — ${incident.caller_address}`);
  }

  // Add transcription turns for the first (resolved) incident
  const firstId = ids[0];
  if (firstId) {
    const turns = [
      { role: "agent",  text: "112, what's your emergency?", ms: 0 },
      { role: "caller", text: "There's a fire — smoke everywhere, it's coming from the flat above the chipper on Tara Street!", ms: 2200 },
      { role: "agent",  text: "Okay, I'm dispatching fire units now. Is anyone still inside the building?", ms: 4800 },
      { role: "caller", text: "I don't know, my neighbour might be upstairs. She's elderly.", ms: 7100 },
      { role: "agent",  text: "Stay back from the building. Fire Brigade are on their way. Do not go back inside.", ms: 9300 },
    ];

    for (const turn of turns) {
      await db.execute({
        sql: `INSERT INTO transcription_turns (id, incident_id, role, text, timestamp_ms, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [crypto.randomUUID(), firstId, turn.role, turn.text, turn.ms, now],
      });
    }
    console.log(`  + Added ${turns.length} transcription turns to incident ${firstId}`);
  }

  console.log(`  Seeded ${SEED_INCIDENTS.length} incidents.`);
}

async function main() {
  console.log("RapidResponse.ai — Database Seed (Dublin)");
  console.log("==========================================");

  const db = await getDb();

  try {
    await seedUnits(db);
    await seedIncidents(db);
    console.log("\nSeed complete.");
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
