/**
 * RAG (Retrieval-Augmented Generation) service.
 *
 * Responsibilities:
 *  1. Embed text using AWS Bedrock Titan Embeddings v2 (1024-dim cosine)
 *  2. Upsert protocol chunks into LanceDB `protocols` collection
 *  3. Search protocols collection and return top-K chunks by cosine similarity
 *  4. Store incident summaries in `incidents_history` for pattern matching
 *
 * CRITICAL: Always use distanceType("cosine") — must match index creation.
 *           Default "l2" is wrong for Titan embeddings.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { env } from "../config/env.ts";
import {
  getLanceDb,
  type ProtocolRecord,
  type ProtocolSearchRow,
  type IncidentHistoryRecord,
} from "../db/lancedb.ts";
import type { ProtocolChunk, ProtocolSearchResult } from "../types/index.ts";

// ---------------------------------------------------------------------------
// Bedrock client singleton
// ---------------------------------------------------------------------------

let _bedrock: BedrockRuntimeClient | null = null;

function getBedrock(): BedrockRuntimeClient {
  if (!_bedrock) {
    _bedrock = new BedrockRuntimeClient({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return _bedrock;
}

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

/**
 * Embed a single string using Titan Embeddings v2.
 * Returns a 1024-dim Float32Array.
 */
export async function embedText(text: string): Promise<Float32Array> {
  const payload = {
    inputText: text,
    dimensions: 1024,
    normalize: true,
  };

  const command = new InvokeModelCommand({
    modelId: env.BEDROCK_TITAN_EMBED_MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(payload),
  });

  let response: Awaited<ReturnType<BedrockRuntimeClient["send"]>>;
  try {
    response = await getBedrock().send(command);
  } catch (err) {
    throw new Error(
      `Titan embedding failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const body = JSON.parse(new TextDecoder().decode(response.body)) as {
    embedding: number[];
  };

  return new Float32Array(body.embedding);
}

// ---------------------------------------------------------------------------
// Protocol chunk upsert
// ---------------------------------------------------------------------------

/**
 * Upsert a protocol chunk into LanceDB.
 * If a record with the same `id` exists, it is replaced.
 */
export async function upsertProtocolChunk(chunk: ProtocolChunk & { embedding: Float32Array }): Promise<void> {
  const db = await getLanceDb();
  const table = await db.openTable("protocols");

  const record: ProtocolRecord = {
    id: chunk.id,
    source_file: chunk.source_file,
    section: chunk.section,
    chunk_text: chunk.chunk_text,
    priority_keywords: JSON.stringify(chunk.priority_keywords),
    embedding: chunk.embedding,
  };

  // Delete existing record with same id (upsert pattern)
  try {
    await table.delete(`id = '${chunk.id}'`);
  } catch {
    // Table may be empty — ignore
  }

  await table.add([record]);
}

// ---------------------------------------------------------------------------
// Protocol search
// ---------------------------------------------------------------------------

/**
 * Search protocol chunks by cosine similarity.
 * Returns top-K results with score (1 - distance).
 */
export async function searchProtocols(
  query: string,
  topK = 3
): Promise<ProtocolSearchResult[]> {
  const embedding = await embedText(query);

  const db = await getLanceDb();
  const table = await db.openTable("protocols");

  let rows: ProtocolSearchRow[];
  try {
    rows = (await table
      .vectorSearch(Array.from(embedding))
      .distanceType("cosine")
      .limit(topK)
      .toArray()) as ProtocolSearchRow[];
  } catch (err) {
    throw new Error(
      `Protocol search failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return rows.map((row) => ({
    id: row.id,
    source_file: row.source_file,
    section: row.section,
    chunk_text: row.chunk_text,
    priority_keywords: safeParseJson<string[]>(row.priority_keywords, []),
    score: 1 - (row._distance ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Incident history upsert
// ---------------------------------------------------------------------------

export async function upsertIncidentHistory(
  record: Omit<IncidentHistoryRecord, "embedding"> & { summary_text: string }
): Promise<void> {
  const embedding = await embedText(record.summary_text);

  const db = await getLanceDb();
  const table = await db.openTable("incidents_history");

  const entry: IncidentHistoryRecord = {
    id: record.id,
    incident_id: record.incident_id,
    summary: record.summary_text,
    incident_type: record.incident_type,
    priority: record.priority,
    created_at: record.created_at,
    embedding,
  };

  try {
    await table.delete(`id = '${record.id}'`);
  } catch {
    // Empty table — ignore
  }

  await table.add([entry]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
