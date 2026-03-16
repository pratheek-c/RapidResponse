/**
 * Database seed script.
 *
 * Populates libSQL with emergency units and incidents across
 * Dublin, Cork, and Galway — Ireland's three largest cities.
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
    "007_add_cad_number.sql",
    "008_add_covert_distress.sql",
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

// ---------------------------------------------------------------------------
// Units — Dublin, Cork, Galway
// ---------------------------------------------------------------------------

type UnitSeed = {
  unit_code: string;
  type: "fire" | "ems" | "police" | "hazmat" | "rescue";
};

const SEED_UNITS: UnitSeed[] = [
  // --- Dublin (DUB) ---
  // National Ambulance Service
  { unit_code: "DUB-AMB-1", type: "ems" },
  { unit_code: "DUB-AMB-2", type: "ems" },
  { unit_code: "DUB-AMB-3", type: "ems" },
  { unit_code: "DUB-AMB-4", type: "ems" },
  { unit_code: "DUB-AMB-5", type: "ems" },
  // Dublin Fire Brigade
  { unit_code: "DUB-FD-1",  type: "fire" },
  { unit_code: "DUB-FD-2",  type: "fire" },
  { unit_code: "DUB-FD-3",  type: "fire" },
  { unit_code: "DUB-FD-4",  type: "fire" },
  { unit_code: "DUB-FD-5",  type: "fire" },
  // Garda Síochána DMR
  { unit_code: "DUB-GD-1",  type: "police" },
  { unit_code: "DUB-GD-2",  type: "police" },
  { unit_code: "DUB-GD-3",  type: "police" },
  { unit_code: "DUB-GD-4",  type: "police" },
  { unit_code: "DUB-GD-5",  type: "police" },
  // HAZMAT & Rescue
  { unit_code: "DUB-HZ-1",  type: "hazmat" },
  { unit_code: "DUB-SAR-1", type: "rescue" },

  // --- Cork (CK) ---
  { unit_code: "CK-AMB-1",  type: "ems" },
  { unit_code: "CK-AMB-2",  type: "ems" },
  { unit_code: "CK-AMB-3",  type: "ems" },
  { unit_code: "CK-AMB-4",  type: "ems" },
  // Cork City Fire Brigade
  { unit_code: "CK-FD-1",   type: "fire" },
  { unit_code: "CK-FD-2",   type: "fire" },
  { unit_code: "CK-FD-3",   type: "fire" },
  // Garda Síochána Cork
  { unit_code: "CK-GD-1",   type: "police" },
  { unit_code: "CK-GD-2",   type: "police" },
  { unit_code: "CK-GD-3",   type: "police" },
  { unit_code: "CK-GD-4",   type: "police" },
  // HAZMAT & Coast Guard
  { unit_code: "CK-HZ-1",   type: "hazmat" },
  { unit_code: "CK-SAR-1",  type: "rescue" },

  // --- Galway (GY) ---
  { unit_code: "GY-AMB-1",  type: "ems" },
  { unit_code: "GY-AMB-2",  type: "ems" },
  { unit_code: "GY-AMB-3",  type: "ems" },
  // Galway City Fire Brigade
  { unit_code: "GY-FD-1",   type: "fire" },
  { unit_code: "GY-FD-2",   type: "fire" },
  // Garda Síochána Galway
  { unit_code: "GY-GD-1",   type: "police" },
  { unit_code: "GY-GD-2",   type: "police" },
  { unit_code: "GY-GD-3",   type: "police" },
  // Coast Guard / Rescue
  { unit_code: "GY-SAR-1",  type: "rescue" },
];

async function seedUnits(db: Awaited<ReturnType<typeof getDb>>) {
  console.log("Seeding units...");

  // Clear in FK-safe order
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

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

type IncidentSeed = {
  cad_number: string;
  caller_id: string;
  caller_location: string;
  caller_address: string;
  status: "active" | "dispatched" | "resolved";
  type: "fire" | "medical" | "police" | "traffic" | "hazmat" | "search_rescue" | "other" | null;
  priority: "P1" | "P2" | "P3" | "P4" | null;
  summary: string | null;
};

const SEED_INCIDENTS: IncidentSeed[] = [

  // =========================================================================
  // DUBLIN — 22 incidents
  // =========================================================================

  {
    cad_number: "INC-20260316-0001",
    caller_id: "tel:+353861234001",
    caller_location: "53.3461,-6.2560",
    caller_address: "Tara Street, Dublin 2",
    status: "resolved",
    type: "fire",
    priority: "P1",
    summary: "Structure fire at flat above chipper on Tara Street. Two DFB units dispatched. Fire extinguished. No injuries.",
  },
  {
    cad_number: "INC-20260316-0002",
    caller_id: "tel:+353861234002",
    caller_location: "53.3498,-6.2603",
    caller_address: "O'Connell Street, Dublin 1",
    status: "dispatched",
    type: "medical",
    priority: "P1",
    summary: "Elderly male collapsed outside the GPO. Possible cardiac event. DUB-AMB-1 dispatched.",
  },
  {
    cad_number: "INC-20260316-0003",
    caller_id: "tel:+353861234003",
    caller_location: "53.3588,-6.2857",
    caller_address: "North Circular Road, Dublin 7",
    status: "dispatched",
    type: "traffic",
    priority: "P2",
    summary: "Two-vehicle RTC at junction of NCR and Phibsborough Road. Two injured. DUB-AMB-2 and DUB-GD-1 dispatched.",
  },
  {
    cad_number: "INC-20260316-0004",
    caller_id: "tel:+353861234004",
    caller_location: "53.3382,-6.2591",
    caller_address: "St. Stephen's Green, Dublin 2",
    status: "active",
    type: null,
    priority: null,
    summary: null,
  },
  {
    cad_number: "INC-20260316-0005",
    caller_id: "tel:+353861234005",
    caller_location: "53.3410,-6.2592",
    caller_address: "Grafton Street, Dublin 2",
    status: "active",
    type: "police",
    priority: "P2",
    summary: null,
  },
  {
    cad_number: "INC-20260316-0006",
    caller_id: "tel:+353861234006",
    caller_location: "53.3576,-6.3267",
    caller_address: "Phoenix Park, Dublin 8",
    status: "dispatched",
    type: "medical",
    priority: "P2",
    summary: "Cyclist struck by vehicle near Áras an Uachtaráin gate. Head injury. DUB-AMB-3 en route.",
  },
  {
    cad_number: "INC-20260316-0007",
    caller_id: "tel:+353861234007",
    caller_location: "53.3730,-6.2697",
    caller_address: "Drumcondra Road, Dublin 9",
    status: "resolved",
    type: "fire",
    priority: "P2",
    summary: "Kitchen fire in terraced house. Confined to kitchen. DUB-FD-2 attended. No casualties.",
  },
  {
    cad_number: "INC-20260316-0008",
    caller_id: "tel:+353861234008",
    caller_location: "53.4110,-6.2483",
    caller_address: "Ballymun Road, Dublin 11",
    status: "dispatched",
    type: "police",
    priority: "P2",
    summary: "Disturbance involving multiple persons outside shopping centre. DUB-GD-2 and DUB-GD-3 responding.",
  },
  {
    cad_number: "INC-20260316-0009",
    caller_id: "tel:+353861234009",
    caller_location: "53.2940,-6.1345",
    caller_address: "George's Street, Dún Laoghaire",
    status: "active",
    type: "medical",
    priority: "P1",
    summary: null,
  },
  {
    cad_number: "INC-20260316-0010",
    caller_id: "tel:+353861234010",
    caller_location: "53.3651,-6.1963",
    caller_address: "Clontarf Road, Dublin 3",
    status: "resolved",
    type: "traffic",
    priority: "P3",
    summary: "Minor rear-end collision on Clontarf Road. No injuries. Vehicles moved to hard shoulder. Garda advised.",
  },
  {
    cad_number: "INC-20260316-0011",
    caller_id: "tel:+353861234011",
    caller_location: "53.3904,-6.3828",
    caller_address: "Blanchardstown Shopping Centre, Dublin 15",
    status: "dispatched",
    type: "medical",
    priority: "P1",
    summary: "Female in her 30s reported unconscious in car park. Possible overdose. DUB-AMB-4 dispatched.",
  },
  {
    cad_number: "INC-20260316-0012",
    caller_id: "tel:+353861234012",
    caller_location: "53.3261,-6.2651",
    caller_address: "Rathmines Road, Dublin 6",
    status: "active",
    type: "fire",
    priority: "P1",
    summary: null,
  },
  {
    cad_number: "INC-20260316-0013",
    caller_id: "tel:+353861234013",
    caller_location: "53.3211,-6.2237",
    caller_address: "Donnybrook Road, Dublin 4",
    status: "resolved",
    type: "police",
    priority: "P3",
    summary: "Report of suspicious vehicle parked outside school. Checked by DUB-GD-4 — false alarm, vehicle belongs to parent.",
  },
  {
    cad_number: "INC-20260316-0014",
    caller_id: "tel:+353861234014",
    caller_location: "53.3872,-6.0647",
    caller_address: "Howth Harbour, Co. Dublin",
    status: "dispatched",
    type: "search_rescue",
    priority: "P1",
    summary: "Kayaker reported overdue. Last seen near East Pier. DUB-SAR-1 and IRCG notified.",
  },
  {
    cad_number: "INC-20260316-0015",
    caller_id: "tel:+353861234015",
    caller_location: "53.2780,-6.2275",
    caller_address: "Sandyford Industrial Estate, Dublin 18",
    status: "dispatched",
    type: "hazmat",
    priority: "P2",
    summary: "Chemical spill at warehouse. Unknown substance. Workers evacuated. DUB-HZ-1 and DUB-FD-3 en route.",
  },
  {
    cad_number: "INC-20260316-0016",
    caller_id: "tel:+353861234016",
    caller_location: "53.3664,-6.2972",
    caller_address: "Cabra Road, Dublin 7",
    status: "active",
    type: "police",
    priority: "P2",
    summary: null,
  },
  {
    cad_number: "INC-20260316-0017",
    caller_id: "tel:+353861234017",
    caller_location: "53.3925,-6.3069",
    caller_address: "Finglas Village, Dublin 11",
    status: "resolved",
    type: "medical",
    priority: "P2",
    summary: "Male fell from ladder at building site. Suspected broken wrist. DUB-AMB-5 attended. Patient transported to Mater.",
  },
  {
    cad_number: "INC-20260316-0018",
    caller_id: "tel:+353861234018",
    caller_location: "53.3286,-6.2488",
    caller_address: "Pearse Street, Dublin 2",
    status: "dispatched",
    type: "traffic",
    priority: "P1",
    summary: "Pedestrian struck by bus. Critical injuries. DUB-AMB-1 and DUB-FD-1 dispatched. Trauma alert raised.",
  },
  {
    cad_number: "INC-20260316-0019",
    caller_id: "tel:+353861234019",
    caller_location: "53.3457,-6.2675",
    caller_address: "Dame Street, Dublin 2",
    status: "active",
    type: null,
    priority: null,
    summary: null,
  },
  {
    cad_number: "INC-20260316-0020",
    caller_id: "tel:+353861234020",
    caller_location: "53.3538,-6.2472",
    caller_address: "Amiens Street, Dublin 1",
    status: "resolved",
    type: "police",
    priority: "P2",
    summary: "Robbery at convenience store. Two suspects fled on foot. DUB-GD-5 attended. CCTV reviewed.",
  },
  {
    cad_number: "INC-20260316-0021",
    caller_id: "tel:+353861234021",
    caller_location: "53.3482,-6.2739",
    caller_address: "Heuston Station, Dublin 8",
    status: "dispatched",
    type: "medical",
    priority: "P2",
    summary: "Male collapsed on platform, suspected seizure. DUB-AMB-2 dispatched.",
  },
  {
    cad_number: "INC-20260316-0022",
    caller_id: "tel:+353861234022",
    caller_location: "53.3362,-6.2860",
    caller_address: "St. James's Hospital, Dublin 8",
    status: "active",
    type: "other",
    priority: "P3",
    summary: null,
  },

  // =========================================================================
  // CORK — 18 incidents
  // =========================================================================

  {
    cad_number: "INC-20260316-0023",
    caller_id: "tel:+353214567001",
    caller_location: "51.8986,-8.4741",
    caller_address: "Patrick Street, Cork City",
    status: "active",
    type: "medical",
    priority: "P1",
    summary: null,
  },
  {
    cad_number: "INC-20260316-0024",
    caller_id: "tel:+353214567002",
    caller_location: "51.9121,-8.4692",
    caller_address: "Blackpool Retail Park, Cork",
    status: "dispatched",
    type: "fire",
    priority: "P1",
    summary: "Fire reported in roof space of retail unit. Sprinklers active. CK-FD-1 and CK-FD-2 dispatched.",
  },
  {
    cad_number: "INC-20260316-0025",
    caller_id: "tel:+353214567003",
    caller_location: "51.8856,-8.5100",
    caller_address: "Wilton Road, Cork",
    status: "resolved",
    type: "traffic",
    priority: "P2",
    summary: "Three-vehicle RTC on Wilton Road near CUH. Two walking wounded. CK-AMB-1 attended. Scene cleared.",
  },
  {
    cad_number: "INC-20260316-0026",
    caller_id: "tel:+353214567004",
    caller_location: "51.8979,-8.4700",
    caller_address: "Grand Parade, Cork City",
    status: "dispatched",
    type: "police",
    priority: "P2",
    summary: "Assault reported outside pub. One person injured. CK-GD-1 and CK-GD-2 responding.",
  },
  {
    cad_number: "INC-20260316-0027",
    caller_id: "tel:+353214567005",
    caller_location: "51.8904,-8.5878",
    caller_address: "Ballincollig Main Street, Co. Cork",
    status: "active",
    type: "medical",
    priority: "P2",
    summary: null,
  },
  {
    cad_number: "INC-20260316-0028",
    caller_id: "tel:+353214567006",
    caller_location: "51.8697,-8.4261",
    caller_address: "Mahon Point Shopping Centre, Cork",
    status: "resolved",
    type: "other",
    priority: "P3",
    summary: "Lift malfunction with occupant inside. Fire brigade assisted with extraction. No injuries.",
  },
  {
    cad_number: "INC-20260316-0029",
    caller_id: "tel:+353214567007",
    caller_location: "51.8791,-8.5019",
    caller_address: "Togher Road, Cork",
    status: "dispatched",
    type: "fire",
    priority: "P2",
    summary: "Bin fire spread to fence of terraced house. CK-FD-3 attending. Residents evacuated as precaution.",
  },
  {
    cad_number: "INC-20260316-0030",
    caller_id: "tel:+353214567008",
    caller_location: "51.9148,-8.4131",
    caller_address: "Glanmire Village, Co. Cork",
    status: "active",
    type: "traffic",
    priority: "P1",
    summary: null,
  },
  {
    cad_number: "INC-20260316-0031",
    caller_id: "tel:+353214567009",
    caller_location: "51.8508,-8.2978",
    caller_address: "Cobh Town Centre, Co. Cork",
    status: "dispatched",
    type: "search_rescue",
    priority: "P1",
    summary: "Child reported missing near ferry terminal. Last seen 40 minutes ago. CK-GD-3 and CK-SAR-1 searching.",
  },
  {
    cad_number: "INC-20260316-0032",
    caller_id: "tel:+353214567010",
    caller_location: "51.9020,-8.4679",
    caller_address: "MacCurtain Street, Cork City",
    status: "resolved",
    type: "police",
    priority: "P2",
    summary: "Domestic disturbance. One person arrested. CK-GD-4 attended. Scene secured.",
  },
  {
    cad_number: "INC-20260316-0033",
    caller_id: "tel:+353214567011",
    caller_location: "51.8963,-8.4910",
    caller_address: "Western Road, Cork City",
    status: "dispatched",
    type: "medical",
    priority: "P1",
    summary: "Student reported unresponsive on UCC campus. Possible alcohol-related. CK-AMB-2 dispatched.",
  },
  {
    cad_number: "INC-20260316-0034",
    caller_id: "tel:+353214567012",
    caller_location: "51.9050,-8.4800",
    caller_address: "Sunday's Well Road, Cork",
    status: "active",
    type: null,
    priority: null,
    summary: null,
  },
  {
    cad_number: "INC-20260316-0035",
    caller_id: "tel:+353214567013",
    caller_location: "51.8940,-8.4600",
    caller_address: "South Mall, Cork City",
    status: "resolved",
    type: "medical",
    priority: "P3",
    summary: "Office worker reported chest tightness. Self-resolved. CK-AMB-3 assessed — no transport required.",
  },
  {
    cad_number: "INC-20260316-0036",
    caller_id: "tel:+353214567014",
    caller_location: "51.9080,-8.4750",
    caller_address: "Pope's Quay, Cork City",
    status: "dispatched",
    type: "hazmat",
    priority: "P2",
    summary: "Gas leak reported from basement of commercial premises. Area being cleared. CK-HZ-1 and CK-FD-1 en route.",
  },
  {
    cad_number: "INC-20260316-0037",
    caller_id: "tel:+353214567015",
    caller_location: "51.8870,-8.5200",
    caller_address: "Bishopstown Road, Cork",
    status: "active",
    type: "police",
    priority: "P2",
    summary: null,
  },
  {
    cad_number: "INC-20260316-0038",
    caller_id: "tel:+353214567016",
    caller_location: "51.9010,-8.4650",
    caller_address: "Merchant's Quay, Cork City",
    status: "resolved",
    type: "traffic",
    priority: "P3",
    summary: "Motorcycle down on quayside. Rider has minor abrasions. Declined ambulance transport.",
  },
  {
    cad_number: "INC-20260316-0039",
    caller_id: "tel:+353214567017",
    caller_location: "51.9143,-8.1730",
    caller_address: "Midleton Town Centre, Co. Cork",
    status: "dispatched",
    type: "fire",
    priority: "P2",
    summary: "Fire in outbuilding of farmhouse. No persons inside. CK-FD-2 dispatched from Midleton station.",
  },
  {
    cad_number: "INC-20260316-0040",
    caller_id: "tel:+353214567018",
    caller_location: "51.9070,-8.4720",
    caller_address: "Bridge Street, Cork City",
    status: "active",
    type: "medical",
    priority: "P1",
    summary: null,
  },

  // =========================================================================
  // GALWAY — 14 incidents
  // =========================================================================

  {
    cad_number: "INC-20260316-0041",
    caller_id: "tel:+353914567001",
    caller_location: "53.2743,-9.0490",
    caller_address: "Eyre Square, Galway City",
    status: "active",
    type: "medical",
    priority: "P1",
    summary: null,
  },
  {
    cad_number: "INC-20260316-0042",
    caller_id: "tel:+353914567002",
    caller_location: "53.2617,-9.0873",
    caller_address: "Salthill Promenade, Galway",
    status: "dispatched",
    type: "search_rescue",
    priority: "P1",
    summary: "Person reported in difficulty in water off Salthill. GY-SAR-1 deployed. IRCG helicopter requested.",
  },
  {
    cad_number: "INC-20260316-0043",
    caller_id: "tel:+353914567003",
    caller_location: "53.2794,-9.0140",
    caller_address: "Renmore Avenue, Galway",
    status: "resolved",
    type: "fire",
    priority: "P2",
    summary: "Shed fire in residential garden. Contained before spread. GY-FD-1 attended. No casualties.",
  },
  {
    cad_number: "INC-20260316-0044",
    caller_id: "tel:+353914567004",
    caller_location: "53.2599,-9.1035",
    caller_address: "Knocknacarra Road, Galway",
    status: "dispatched",
    type: "traffic",
    priority: "P2",
    summary: "Single-vehicle collision. Car mounted footpath. Driver conscious but dazed. GY-AMB-1 and GY-GD-1 responding.",
  },
  {
    cad_number: "INC-20260316-0045",
    caller_id: "tel:+353914567005",
    caller_location: "53.2932,-9.0505",
    caller_address: "Tuam Road, Galway",
    status: "active",
    type: "police",
    priority: "P2",
    summary: null,
  },
  {
    cad_number: "INC-20260316-0046",
    caller_id: "tel:+353914567006",
    caller_location: "53.2710,-9.0380",
    caller_address: "Galway Docks, Galway City",
    status: "resolved",
    type: "hazmat",
    priority: "P2",
    summary: "Fuel spill on dock road. Coast Guard and port authority notified. GY-FD-2 assisted with containment.",
  },
  {
    cad_number: "INC-20260316-0047",
    caller_id: "tel:+353914567007",
    caller_location: "53.2730,-9.0500",
    caller_address: "Shop Street, Galway City",
    status: "dispatched",
    type: "medical",
    priority: "P2",
    summary: "Tourist collapsed in pedestrian area. Suspected heat exhaustion. GY-AMB-2 dispatched.",
  },
  {
    cad_number: "INC-20260316-0048",
    caller_id: "tel:+353914567008",
    caller_location: "53.2760,-9.0550",
    caller_address: "Nun's Island, Galway City",
    status: "resolved",
    type: "other",
    priority: "P4",
    summary: "Tree fallen across road blocking traffic. Council notified. GY-GD-2 managed traffic.",
  },
  {
    cad_number: "INC-20260316-0049",
    caller_id: "tel:+353914567009",
    caller_location: "53.2720,-9.0460",
    caller_address: "Dominick Street, Galway City",
    status: "active",
    type: "fire",
    priority: "P1",
    summary: null,
  },
  {
    cad_number: "INC-20260316-0050",
    caller_id: "tel:+353914567010",
    caller_location: "53.2609,-8.9281",
    caller_address: "Oranmore Village, Co. Galway",
    status: "dispatched",
    type: "traffic",
    priority: "P1",
    summary: "Head-on collision on N18 near Oranmore junction. Multiple casualties reported. GY-AMB-3, GY-FD-1, GY-GD-3 dispatched.",
  },
  {
    cad_number: "INC-20260316-0051",
    caller_id: "tel:+353914567011",
    caller_location: "53.2780,-9.0620",
    caller_address: "Galway University Hospital, Newcastle Road",
    status: "active",
    type: "other",
    priority: "P3",
    summary: null,
  },
  {
    cad_number: "INC-20260316-0052",
    caller_id: "tel:+353914567012",
    caller_location: "53.2700,-9.0520",
    caller_address: "Quay Street, Galway City",
    status: "resolved",
    type: "police",
    priority: "P2",
    summary: "Large disturbance outside pub on Quay Street. Three arrested. GY-GD-1 and GY-GD-2 attended.",
  },
  {
    cad_number: "INC-20260316-0053",
    caller_id: "tel:+353914567013",
    caller_location: "53.2840,-9.0490",
    caller_address: "Headford Road, Galway",
    status: "dispatched",
    type: "medical",
    priority: "P2",
    summary: "Child with suspected broken arm after fall at playground. GY-AMB-1 dispatched.",
  },
  {
    cad_number: "INC-20260316-0054",
    caller_id: "tel:+353914567014",
    caller_location: "53.2655,-9.0700",
    caller_address: "Salthill Road Lower, Galway",
    status: "active",
    type: "police",
    priority: "P1",
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
              (id, cad_number, caller_id, caller_location, caller_address, status, type, priority, summary,
               created_at, updated_at, resolved_at, s3_audio_prefix, s3_transcript_key)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      args: [
        id,
        incident.cad_number,
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

    console.log(`  + ${incident.cad_number} [${incident.status}] ${incident.type ?? "unclassified"} — ${incident.caller_address}`);
  }

  // Transcription turns for the first resolved incident (Tara Street fire)
  const firstId = ids[0];
  if (firstId) {
    const turns = [
      { role: "agent",  text: "112, what's your emergency?", ms: 0 },
      { role: "caller", text: "There's a fire — smoke everywhere, coming from the flat above the chipper on Tara Street!", ms: 2200 },
      { role: "agent",  text: "Okay, I'm dispatching fire units now. Is anyone still inside the building?", ms: 4800 },
      { role: "caller", text: "I don't know, my neighbour might be upstairs. She's elderly.", ms: 7100 },
      { role: "agent",  text: "Stay back from the building. Dublin Fire Brigade are on their way. Do not go back inside.", ms: 9300 },
    ];
    for (const turn of turns) {
      await db.execute({
        sql: `INSERT INTO transcription_turns (id, incident_id, role, text, timestamp_ms, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [crypto.randomUUID(), firstId, turn.role, turn.text, turn.ms, now],
      });
    }
    console.log(`  + Added ${turns.length} transcription turns to ${SEED_INCIDENTS[0]!.cad_number}`);
  }

  console.log(`  Seeded ${SEED_INCIDENTS.length} incidents.`);
}

async function main() {
  console.log("RapidResponse.ai — Database Seed (Dublin · Cork · Galway)");
  console.log("============================================================");

  const db = await getDb();

  try {
    await seedUnits(db);
    await seedIncidents(db);
    console.log("\nSeed complete.");
    console.log(`  Units  : ${SEED_UNITS.length}`);
    console.log(`  Incidents: ${SEED_INCIDENTS.length}`);
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
