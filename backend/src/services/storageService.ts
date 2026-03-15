/**
 * S3 storage service.
 *
 * Handles:
 *  - Uploading raw audio chunks (WebM/PCM) during a call
 *  - Uploading final transcript JSON
 *  - Generating presigned URLs for playback
 *
 * Key format: recordings/{incident_id}/audio_{unix_ms}.webm
 * Transcript:  recordings/{incident_id}/transcript.json
 *
 * NEVER expose bucket URLs directly — always use presigned URLs.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.ts";

// ---------------------------------------------------------------------------
// Singleton S3 client
// ---------------------------------------------------------------------------

let _s3: S3Client | null = null;

function getS3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      region: env.AWS_REGION,
      ...(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: env.AWS_ACCESS_KEY_ID,
              secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
              ...(env.AWS_SESSION_TOKEN ? { sessionToken: env.AWS_SESSION_TOKEN } : {}),
            },
          }
        : {}),
      followRegionRedirects: true,
    });
  }
  return _s3;
}

// ---------------------------------------------------------------------------
// Key builders
// ---------------------------------------------------------------------------

export function audioChunkKey(incident_id: string, unix_ms: number): string {
  return `${env.S3_RECORDINGS_PREFIX}${incident_id}/audio_${unix_ms}.webm`;
}

export function transcriptKey(incident_id: string): string {
  return `${env.S3_RECORDINGS_PREFIX}${incident_id}/transcript.json`;
}

// ---------------------------------------------------------------------------
// Upload helpers
// ---------------------------------------------------------------------------

/** Upload a raw audio buffer (PCM/WebM) for a call segment. */
export async function uploadAudioChunk(
  incident_id: string,
  buffer: Buffer | Uint8Array,
  contentType = "audio/webm"
): Promise<string> {
  const key = audioChunkKey(incident_id, Date.now());
  await upload(key, buffer, contentType);
  return key;
}

/** Upload the final transcript JSON for an incident. */
export async function uploadTranscript(
  incident_id: string,
  transcript: unknown
): Promise<string> {
  const key = transcriptKey(incident_id);
  const body = JSON.stringify(transcript, null, 2);
  await upload(key, Buffer.from(body, "utf-8"), "application/json");
  return key;
}

/** Generic PUT to S3. */
async function upload(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<void> {
  const input: PutObjectCommandInput = {
    Bucket: env.S3_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
  };

  try {
    await getS3().send(new PutObjectCommand(input));
  } catch (err) {
    throw new Error(
      `S3 upload failed for key "${key}": ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Presigned URL helpers
// ---------------------------------------------------------------------------

/** Generate a presigned GET URL. Default expiry: 1 hour. */
export async function presignedGetUrl(
  key: string,
  expiresInSeconds = 3600
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: env.S3_BUCKET_NAME,
    Key: key,
  });

  try {
    return await getSignedUrl(getS3(), command, { expiresIn: expiresInSeconds });
  } catch (err) {
    throw new Error(
      `Failed to generate presigned URL for "${key}": ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** Presigned URL for an audio chunk. */
export async function getAudioPlaybackUrl(
  key: string,
  expiresInSeconds = 3600
): Promise<string> {
  return presignedGetUrl(key, expiresInSeconds);
}

/** Presigned URL for a transcript JSON. */
export async function getTranscriptUrl(
  incident_id: string,
  expiresInSeconds = 3600
): Promise<string> {
  return presignedGetUrl(transcriptKey(incident_id), expiresInSeconds);
}
