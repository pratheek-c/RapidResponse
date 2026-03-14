/**
 * Frontend shared types — mirror of backend/src/types/index.ts
 * Kept in sync manually; no runtime import from backend package.
 */

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
  id: string;
  caller_id: string;
  caller_location: string;
  status: IncidentStatus;
  type: IncidentType | null;
  priority: IncidentPriority | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  s3_audio_prefix: string | null;
  s3_transcript_key: string | null;
};

export type TranscriptionRole = "caller" | "agent";

export type TranscriptionTurn = {
  id: string;
  incident_id: string;
  role: TranscriptionRole;
  text: string;
  timestamp_ms: number;
  created_at: string;
};

export type UnitType = "fire" | "ems" | "police" | "hazmat" | "rescue";
export type UnitStatus = "available" | "dispatched" | "on_scene" | "returning";

export type Unit = {
  id: string;
  unit_code: string;
  type: UnitType;
  status: UnitStatus;
  current_incident_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Dispatch = {
  id: string;
  incident_id: string;
  unit_id: string;
  dispatched_at: string;
  arrived_at: string | null;
  cleared_at: string | null;
};

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
  timestamp: string;
};

// WebSocket messages sent from browser to backend
export type WsCallStartMessage = {
  type: "call_start";
  caller_id: string;
  location: string;
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

// WebSocket messages received from backend
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

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiError = { ok: false; error: string };
export type ApiResponse<T> = ApiSuccess<T> | ApiError;
