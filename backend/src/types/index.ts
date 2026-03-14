/**
 * Shared TypeScript types for RapidResponse.ai backend.
 * All types are exported individually (no default export).
 */

// ---------------------------------------------------------------------------
// Incident
// ---------------------------------------------------------------------------

export type IncidentStatus = "active" | "dispatched" | "resolved" | "cancelled";

export type IncidentPriority = "P1" | "P2" | "P3" | "P4";

export type IncidentType =
  | "fire"
  | "medical"
  | "police"
  | "traffic"
  | "hazmat"
  | "search_rescue"
  | "other";

export type Incident = {
  id: string; // UUID
  caller_id: string;
  caller_location: string; // "lat, lng" GPS string
  caller_address: string;  // reverse-geocoded human address
  status: IncidentStatus;
  type: IncidentType | null;
  priority: IncidentPriority | null;
  summary: string | null;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  resolved_at: string | null; // ISO 8601
  s3_audio_prefix: string | null;
  s3_transcript_key: string | null;
};

export type CreateIncidentInput = {
  caller_id: string;
  caller_location: string; // "lat, lng" GPS string
  caller_address: string;  // reverse-geocoded human address
};

export type UpdateIncidentInput = {
  status?: IncidentStatus;
  type?: IncidentType;
  priority?: IncidentPriority;
  summary?: string;
  resolved_at?: string;
  s3_audio_prefix?: string;
  s3_transcript_key?: string;
};

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

export type TranscriptionRole = "caller" | "agent";

export type TranscriptionTurn = {
  id: string; // UUID
  incident_id: string;
  role: TranscriptionRole;
  text: string;
  timestamp_ms: number; // milliseconds since call start
  created_at: string; // ISO 8601
};

export type CreateTranscriptionTurnInput = {
  incident_id: string;
  role: TranscriptionRole;
  text: string;
  timestamp_ms: number;
};

// ---------------------------------------------------------------------------
// Dispatch Units
// ---------------------------------------------------------------------------

export type UnitType = "fire" | "ems" | "police" | "hazmat" | "rescue";

export type UnitStatus = "available" | "dispatched" | "on_scene" | "returning";

export type Unit = {
  id: string; // UUID
  unit_code: string; // e.g. "EMS-7", "FD-3"
  type: UnitType;
  status: UnitStatus;
  current_incident_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Dispatch = {
  id: string; // UUID
  incident_id: string;
  unit_id: string;
  dispatched_at: string; // ISO 8601
  arrived_at: string | null;
  cleared_at: string | null;
};

export type CreateDispatchInput = {
  incident_id: string;
  unit_id: string;
};

// ---------------------------------------------------------------------------
// RAG / Protocol
// ---------------------------------------------------------------------------

export type ProtocolChunk = {
  id: string;
  source_file: string;
  section: string;
  chunk_text: string;
  priority_keywords: string[];
  // embedding: Float32Array  — not included in query results, only during upsert
};

export type ProtocolSearchResult = ProtocolChunk & {
  score: number; // cosine similarity (0–1)
};

// ---------------------------------------------------------------------------
// Nova Sonic Tool Definitions
// ---------------------------------------------------------------------------

export type NovaToolName =
  | "classify_incident"
  | "get_protocol"
  | "dispatch_unit";

export type ClassifyIncidentInput = {
  type: IncidentType;
  priority: IncidentPriority;
};

export type GetProtocolInput = {
  query: string;
};

export type DispatchUnitInput = {
  incident_id: string;
  unit_type: UnitType;
};

export type NovaToolInput =
  | ClassifyIncidentInput
  | GetProtocolInput
  | DispatchUnitInput;

export type NovaToolResult = {
  success: boolean;
  data: unknown;
  error?: string;
};

// ---------------------------------------------------------------------------
// SSE Events (pushed to dispatcher dashboard)
// ---------------------------------------------------------------------------

export type SseEventType =
  | "incident_created"
  | "incident_updated"
  | "incident_classified"
  | "unit_dispatched"
  | "transcription_turn"
  | "call_ended";

export type SseEvent = {
  type: SseEventType;
  incident_id: string;
  payload: unknown;
  timestamp: string; // ISO 8601
};

// ---------------------------------------------------------------------------
// WebSocket messages (browser <-> backend)
// ---------------------------------------------------------------------------

export type WsClientMessageType =
  | "call_start"
  | "audio_chunk"
  | "call_end";

export type WsCallStartMessage = {
  type: "call_start";
  caller_id: string;
  location: string;  // "lat, lng" GPS string
  address: string;   // reverse-geocoded human address
};

export type WsAudioChunkMessage = {
  type: "audio_chunk";
  data: string; // base64-encoded PCM 16-bit 16kHz mono
};

export type WsCallEndMessage = {
  type: "call_end";
};

export type WsClientMessage =
  | WsCallStartMessage
  | WsAudioChunkMessage
  | WsCallEndMessage;

export type WsServerMessageType =
  | "call_accepted"
  | "audio_response"
  | "transcript_update"
  | "incident_classified"
  | "error"
  | "call_ended";

export type WsCallAcceptedMessage = {
  type: "call_accepted";
  incident_id: string;
};

export type WsAudioResponseMessage = {
  type: "audio_response";
  data: string; // base64-encoded PCM 16-bit 24kHz mono
};

export type WsTranscriptUpdateMessage = {
  type: "transcript_update";
  role: TranscriptionRole;
  text: string;
};

export type WsIncidentClassifiedMessage = {
  type: "incident_classified";
  incident_type: IncidentType;
  priority: IncidentPriority;
};

export type WsErrorMessage = {
  type: "error";
  message: string;
};

export type WsCallEndedMessage = {
  type: "call_ended";
  incident_id: string;
};

export type WsServerMessage =
  | WsCallAcceptedMessage
  | WsAudioResponseMessage
  | WsTranscriptUpdateMessage
  | WsIncidentClassifiedMessage
  | WsErrorMessage
  | WsCallEndedMessage;

// ---------------------------------------------------------------------------
// HTTP API response shapes
// ---------------------------------------------------------------------------

export type ApiSuccess<T> = {
  ok: true;
  data: T;
};

export type ApiError = {
  ok: false;
  error: string;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
