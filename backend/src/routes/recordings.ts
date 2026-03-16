/**
 * Recordings REST routes.
 *
 * GET /recordings/:incident_id/audio     List audio chunk keys for an incident
 * GET /recordings/:incident_id/playback  Get presigned URL for an audio key
 * GET /recordings/:incident_id/transcript  Get presigned URL for the transcript JSON
 */

import { getDb } from "../db/libsql.ts";
import {
  getAudioPlaybackUrl,
  getTranscriptUrl,
} from "../services/storageService.ts";

export async function handleRecordings(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const url = new URL(req.url);
  // /recordings/:incident_id/:action
  const subPath = url.pathname.replace(/^\/recordings\/?/, "");
  const parts = subPath.split("/");

  const incident_id = parts[0];
  const action = parts[1];

  if (!incident_id) return badRequest("Missing incident_id");

  if (action === "transcript") {
    try {
      const presignedUrl = await getTranscriptUrl(incident_id);
      return json({ ok: true, data: { url: presignedUrl } });
    } catch (err) {
      return jsonError(err, 500);
    }
  }

  if (action === "playback") {
    // Expects ?key=recordings/incident_id/audio_xxx.webm
    const key = url.searchParams.get("key");
    if (!key) return badRequest("Query parameter 'key' is required");

    try {
      const presignedUrl = await getAudioPlaybackUrl(key);
      return json({ ok: true, data: { url: presignedUrl } });
    } catch (err) {
      return jsonError(err, 500);
    }
  }

  if (action === "audio") {
    // Return the incident's s3_audio_prefix from DB
    const db = getDb();
    try {
      const result = await db.execute({
        sql: "SELECT s3_audio_prefix FROM incidents WHERE id = :id",
        args: { id: incident_id },
      });
      const row = result.rows[0];
      if (!row) return json({ ok: false, error: "Incident not found" }, 404);
      return json({ ok: true, data: { s3_prefix: row["s3_audio_prefix"] } });
    } catch (err) {
      return jsonError(err, 500);
    }
  }

  return notFound();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(err: unknown, status: number): Response {
  const message = err instanceof Error ? err.message : String(err);
  return json({ ok: false, error: message }, status);
}

function badRequest(message: string): Response {
  return json({ ok: false, error: message }, 400);
}

function notFound(): Response {
  return json({ ok: false, error: "Not found" }, 404);
}
