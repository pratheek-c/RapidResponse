/**
 * LanceDB connection + Arrow schemas + collection initialisation.
 *
 * Package: @lancedb/lancedb (NOT legacy vectordb)
 * Peer dep: apache-arrow >=15 <=18
 *
 * Three collections:
 *   - protocols          RAG chunks from emergency protocol docs
 *   - incidents_history  Past incident embeddings for pattern matching
 *   - locations          Geocoded addresses with S2 cell tokens
 *
 * Always use distanceType("cosine") — must match at both index creation
 * and query time. Default "l2" is incorrect for Titan Embeddings v2.
 */

import * as lancedb from "@lancedb/lancedb";
import {
  Field,
  FixedSizeList,
  Float32,
  Schema,
  Utf8,
  Int32,
} from "apache-arrow";
import { env } from "../config/env.ts";

export type LanceConnection = lancedb.Connection;
export type LanceTable = lancedb.Table;

// ---------------------------------------------------------------------------
// Arrow schemas
// ---------------------------------------------------------------------------

/** 1024-dim Float32 vector field — Titan Embeddings v2 output dimension */
const EMBEDDING_FIELD = new Field(
  "embedding",
  new FixedSizeList(1024, new Field("item", new Float32(), false)),
  false
);

export const PROTOCOLS_SCHEMA = new Schema([
  new Field("id", new Utf8(), false),
  new Field("source_file", new Utf8(), false),
  new Field("section", new Utf8(), false),
  new Field("chunk_text", new Utf8(), false),
  new Field("priority_keywords", new Utf8(), false), // JSON-serialised string[]
  EMBEDDING_FIELD,
]);

export const INCIDENTS_HISTORY_SCHEMA = new Schema([
  new Field("id", new Utf8(), false),
  new Field("incident_id", new Utf8(), false),
  new Field("summary", new Utf8(), false),
  new Field("incident_type", new Utf8(), false),
  new Field("priority", new Utf8(), false),
  new Field("created_at", new Utf8(), false),
  EMBEDDING_FIELD,
]);

export const LOCATIONS_SCHEMA = new Schema([
  new Field("id", new Utf8(), false),
  new Field("address", new Utf8(), false),
  new Field("city", new Utf8(), false),
  new Field("latitude", new Float32(), false),
  new Field("longitude", new Float32(), false),
  new Field("s2_cell_token_13", new Utf8(), false), // S2 level 13 (~1.2 km²)
  new Field("s2_cell_token_15", new Utf8(), false), // S2 level 15 (~300 m²)
  new Field("unit_count", new Int32(), false),
  EMBEDDING_FIELD,
]);

// ---------------------------------------------------------------------------
// Singleton connection
// ---------------------------------------------------------------------------

let _connection: lancedb.Connection | null = null;

export async function getLanceDb(): Promise<lancedb.Connection> {
  if (!_connection) {
    _connection = await lancedb.connect(env.LANCEDB_PATH);
  }
  return _connection;
}

/** Tear down connection. Used in tests. */
export async function closeLanceDb(): Promise<void> {
  _connection = null;
}

// ---------------------------------------------------------------------------
// Collection initialisation
// ---------------------------------------------------------------------------

/**
 * Idempotently create all three LanceDB tables.
 * Safe to call on every startup — uses existOk: true equivalent
 * (creates only if the table does not exist).
 */
export async function initCollections(
  db: lancedb.Connection
): Promise<void> {
  const existingTables = await db.tableNames();

  if (!existingTables.includes("protocols")) {
    await db.createEmptyTable("protocols", PROTOCOLS_SCHEMA);
  }

  if (!existingTables.includes("incidents_history")) {
    await db.createEmptyTable("incidents_history", INCIDENTS_HISTORY_SCHEMA);
  }

  if (!existingTables.includes("locations")) {
    await db.createEmptyTable("locations", LOCATIONS_SCHEMA);
  }
}

// ---------------------------------------------------------------------------
// Protocol chunk types (matches Arrow schema)
// ---------------------------------------------------------------------------

export type ProtocolRecord = {
  id: string;
  source_file: string;
  section: string;
  chunk_text: string;
  priority_keywords: string; // JSON string
  embedding: Float32Array;
};

export type ProtocolSearchRow = {
  id: string;
  source_file: string;
  section: string;
  chunk_text: string;
  priority_keywords: string;
  _distance: number;
};

export type IncidentHistoryRecord = {
  id: string;
  incident_id: string;
  summary: string;
  incident_type: string;
  priority: string;
  created_at: string;
  embedding: Float32Array;
};

export type LocationRecord = {
  id: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  s2_cell_token_13: string;
  s2_cell_token_15: string;
  unit_count: number;
  embedding: Float32Array;
};
