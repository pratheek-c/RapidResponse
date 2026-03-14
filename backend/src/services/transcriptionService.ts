/**
 * Transcription service.
 *
 * Saves each turn of the Nova Sonic conversation to libSQL.
 * Provides transcript retrieval for export to S3.
 */

import { getDb } from "../db/libsql.ts";
import {
  dbCreateTranscriptionTurn,
  dbGetTranscription,
} from "../db/libsql.ts";
import { sseSend } from "./sseService.ts";
import type {
  TranscriptionTurn,
  CreateTranscriptionTurnInput,
  TranscriptionRole,
} from "../types/index.ts";

// ---------------------------------------------------------------------------
// Save a turn
// ---------------------------------------------------------------------------

export async function saveTurn(
  input: CreateTranscriptionTurnInput
): Promise<TranscriptionTurn> {
  const db = getDb();
  try {
    const turn = await dbCreateTranscriptionTurn(db, input);
    sseSend("transcription_turn", input.incident_id, {
      role: input.role,
      text: input.text,
      timestamp_ms: input.timestamp_ms,
    });
    return turn;
  } catch (err) {
    throw new Error(
      `Failed to save transcription turn: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Save a speaker-labelled turn (convenience wrapper)
// ---------------------------------------------------------------------------

export async function saveAgentTurn(
  incident_id: string,
  text: string,
  timestamp_ms: number
): Promise<TranscriptionTurn> {
  return saveTurn({ incident_id, role: "agent", text, timestamp_ms });
}

export async function saveCallerTurn(
  incident_id: string,
  text: string,
  timestamp_ms: number
): Promise<TranscriptionTurn> {
  return saveTurn({ incident_id, role: "caller", text, timestamp_ms });
}

// ---------------------------------------------------------------------------
// Retrieve full transcript
// ---------------------------------------------------------------------------

export async function getTranscript(
  incident_id: string
): Promise<TranscriptionTurn[]> {
  const db = getDb();
  try {
    return await dbGetTranscription(db, incident_id);
  } catch (err) {
    throw new Error(
      `Failed to retrieve transcript for incident ${incident_id}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Export transcript to a JSON-serialisable format for S3 storage
// ---------------------------------------------------------------------------

export type TranscriptExport = {
  incident_id: string;
  exported_at: string;
  turns: Array<{
    role: TranscriptionRole;
    text: string;
    timestamp_ms: number;
  }>;
};

export async function exportTranscript(
  incident_id: string
): Promise<TranscriptExport> {
  const turns = await getTranscript(incident_id);
  return {
    incident_id,
    exported_at: new Date().toISOString(),
    turns: turns.map((t) => ({
      role: t.role,
      text: t.text,
      timestamp_ms: t.timestamp_ms,
    })),
  };
}
