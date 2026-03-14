/**
 * Database seed script.
 *
 * Populates libSQL with sample units, incidents and transcriptions
 * for development and demo purposes.
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

  for (const file of ["001_initial.sql", "002_add_indexes.sql"]) {
    const version = file.replace(".sql", "");
    if (applied.has(version)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf-8");
    await db.executeMultiple(sql);
    await db.execute({
      sql: "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      args: [version, new Date().toISOString()],
    });
  }

  return db;
}

type UnitSeed = {
  unit_code: string;
  type: "fire" | "ems" | "police" | "hazmat" | "rescue";
};

const SEED_UNITS: UnitSeed[] = [
  { unit_code: "EMS-1", type: "ems" },
  { unit_code: "EMS-2", type: "ems" },
  { unit_code: "EMS-3", type: "ems" },
  { unit_code: "FD-1", type: "fire" },
  { unit_code: "FD-2", type: "fire" },
  { unit_code: "FD-3", type: "fire" },
  { unit_code: "PD-1", type: "police" },
  { unit_code: "PD-2", type: "police" },
  { unit_code: "PD-3", type: "police" },
  { unit_code: "PD-4", type: "police" },
  { unit_code: "HZ-1", type: "hazmat" },
  { unit_code: "SAR-1", type: "rescue" },
];

async function seedUnits(db: Awaited<ReturnType<typeof getDb>>) {
  console.log("Seeding units...");

  // Delete existing seed units
  await db.execute("DELETE FROM units WHERE unit_code LIKE 'EMS-%' OR unit_code LIKE 'FD-%' OR unit_code LIKE 'PD-%' OR unit_code LIKE 'HZ-%' OR unit_code LIKE 'SAR-%'");

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
  status: "active" | "dispatched" | "resolved";
  type: "fire" | "medical" | "police" | "traffic" | "hazmat" | "search_rescue" | "other" | null;
  priority: "P1" | "P2" | "P3" | "P4" | null;
  summary: string | null;
};

const SEED_INCIDENTS: IncidentSeed[] = [
  {
    caller_id: "tel:+15551234001",
    caller_location: "123 Oak Street, Springfield",
    status: "resolved",
    type: "fire",
    priority: "P1",
    summary: "Structure fire at residential address. Two fire units dispatched. Fire extinguished. No injuries.",
  },
  {
    caller_id: "tel:+15551234002",
    caller_location: "456 Elm Avenue, Springfield",
    status: "dispatched",
    type: "medical",
    priority: "P1",
    summary: "Caller reported elderly male unconscious. EMS-1 dispatched.",
  },
  {
    caller_id: "tel:+15551234003",
    caller_location: "Springfield Highway 101, Mile Marker 23",
    status: "dispatched",
    type: "traffic",
    priority: "P2",
    summary: "Multi-vehicle collision. Two injuries reported. EMS and Police dispatched.",
  },
  {
    caller_id: "tel:+15551234004",
    caller_location: "789 Main Street, Springfield",
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
              (id, caller_id, caller_location, status, type, priority, summary,
               created_at, updated_at, resolved_at, s3_audio_prefix, s3_transcript_key)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      args: [
        id,
        incident.caller_id,
        incident.caller_location,
        incident.status,
        incident.type,
        incident.priority,
        incident.summary,
        now,
        now,
        resolvedAt,
      ],
    });

    console.log(`  + ${id} [${incident.status}] ${incident.type ?? "unclassified"}`);
  }

  // Add some transcription turns for the first incident
  const firstId = ids[0];
  if (firstId) {
    const turns = [
      { role: "agent", text: "911, what is your emergency?", ms: 0 },
      { role: "caller", text: "There's a fire at my house, 123 Oak Street!", ms: 2000 },
      { role: "agent", text: "I'm dispatching fire services now. Are you and everyone else out of the building?", ms: 4500 },
      { role: "caller", text: "Yes we're outside, but my neighbor might still be inside!", ms: 7000 },
      { role: "agent", text: "Stay clear of the building. Fire units are on their way. Do not go back inside.", ms: 9000 },
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
  console.log("RapidResponse.ai — Database Seed");
  console.log("==================================");

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
