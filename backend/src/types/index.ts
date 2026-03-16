/**
 * Shared TypeScript types for RapidResponse.ai backend.
 * All types are exported individually (no default export).
 */

// ---------------------------------------------------------------------------
// Incident
// ---------------------------------------------------------------------------

export type IncidentStatus =
  | "active"       // Call in progress, Sonic talking to caller
  | "classified"   // Sonic fired classify_incident tool
  | "dispatched"   // Officer accepted, units assigned
  | "en_route"     // Units traveling
  | "on_scene"     // Units arrived
  | "completed"    // Case closed, report saved
  | "resolved"     // Legacy alias for completed
  | "cancelled";

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
  cad_number: string | null; // e.g. INC-20260316-0001
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
  // Dispatch extension columns
  accepted_at: string | null;
  completed_at: string | null;
  escalated: number; // 0 or 1
  officer_id: string | null;
  assigned_units: string | null; // JSON array of unit_ids
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
  // Dispatch extension
  accepted_at?: string;
  completed_at?: string;
  escalated?: number;
  officer_id?: string;
  assigned_units?: string; // JSON array string
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
  | "report_update"
  | "dispatcher_approaching"
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

// ---------------------------------------------------------------------------
// Incident Report (generated by Report Agent / Nova Lite)
// ---------------------------------------------------------------------------

export type ReportTimelineEvent = {
  timestamp_ms: number;
  event: string;
};

export type DispatcherAssigned = {
  id: string;
  name: string;
  badge: string;
  desk: string;
  certifications: string[];
};

export type DispatchedUnitSummary = {
  unit_code: string;
  type: string;
  eta_minutes: number;
  distance_km: number;
  crew_lead: string;
  crew: { name: string; role: string }[];
};

export type IncidentReport = {
  incident_id: string;
  summary: string;
  incident_type: IncidentType | null;
  priority: IncidentPriority | null;
  caller_details: string;
  timeline: ReportTimelineEvent[];
  units_dispatched: DispatchedUnitSummary[];
  dispatcher_assigned: DispatcherAssigned | null;
  recommended_actions: string[];
  approaching_unit: {
    unit_code: string;
    eta_minutes: number;
    crew: { name: string; role: string }[];
  } | null;
  status: IncidentStatus;
  generated_at: string; // ISO 8601
};

export type WsReportUpdateMessage = {
  type: "report_update";
  report: IncidentReport;
};

export type WsDispatcherApproachingMessage = {
  type: "dispatcher_approaching";
  unit_code: string;
  eta_minutes: number;
  crew: { name: string; role: string }[];
};

export type WsServerMessage =
  | WsCallAcceptedMessage
  | WsAudioResponseMessage
  | WsTranscriptUpdateMessage
  | WsIncidentClassifiedMessage
  | WsReportUpdateMessage
  | WsDispatcherApproachingMessage
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

// ---------------------------------------------------------------------------
// Dashboard Dispatch — new types
// ---------------------------------------------------------------------------

/**
 * Department label used by the dashboard API.
 * Maps to UnitType at the DB boundary:
 *   patrol ↔ police
 *   medical ↔ ems
 *   fire ↔ fire
 *   hazmat ↔ hazmat
 */
export type Department = "patrol" | "fire" | "medical" | "hazmat";

/** Numeric severity 1 (routine) – 5 (critical) */
export type Priority = 1 | 2 | 3 | 4 | 5;

// --- Request body shapes for dispatch routes ---

export type AcceptRequest = {
  incident_id: string;
  unit_ids: string[];
  officer_id: string;
};

export type QuestionRequest = {
  incident_id: string;
  question: string;
  officer_id: string;
};

export type EscalateRequest = {
  incident_id: string;
  reason: string;
  requested_unit_types: Department[];
};

export type CompleteRequest = {
  incident_id: string;
  officer_notes?: string;
};

export type SaveReportRequest = {
  incident_id: string;
  summary: string;
};

// --- New DB row types ---

export type DispatchAction = {
  id: string;
  incident_id: string;
  action_type: "accept" | "escalate" | "question" | "complete" | "save_report";
  officer_id: string | null;
  payload: string | null; // JSON string
  created_at: string;
};

export type CreateDispatchActionInput = {
  incident_id: string;
  action_type: DispatchAction["action_type"];
  officer_id?: string;
  payload?: Record<string, unknown>;
};

export type IncidentUnit = {
  id: string;
  incident_id: string;
  unit_id: string;
  unit_type: UnitType;
  status: "dispatched" | "en_route" | "on_scene";
  dispatched_at: string;
  arrived_at: string | null;
};

export type CreateIncidentUnitInput = {
  incident_id: string;
  unit_id: string;
  unit_type: UnitType;
};

export type DispatchQuestion = {
  id: string;
  incident_id: string;
  officer_id: string | null;
  question: string;
  refined_question: string | null;
  answer: string | null;
  asked_at: string;
  answered_at: string | null;
};

export type CreateDispatchQuestionInput = {
  incident_id: string;
  officer_id?: string;
  question: string;
  refined_question?: string;
};

// --- SSE event union for the dispatcher dashboard ---

export type DashboardSSEEvent =
  | { type: "incident_created";      data: { incident_id: string; created_at: string } }
  | { type: "incident_classified";   data: { incident_id: string; incident_type: string; priority: IncidentPriority } }
  | { type: "transcript_update";     data: { incident_id: string; role: "caller" | "ai"; text: string; timestamp: string } }
  | { type: "extraction_update";     data: { incident_id: string; extraction: Record<string, unknown> } }
  | { type: "answer_update";         data: { incident_id: string; question: string; answer: string } }
  | { type: "unit_dispatched";       data: { incident_id: string; unit_id: string; unit_type: Department } }
  | { type: "status_change";         data: { incident_id: string; status: IncidentStatus; unit_id?: string } }
  | { type: "escalation_suggestion"; data: { incident_id: string; reason: string; suggested_units: Department[] } }
  | { type: "incident_completed";    data: { incident_id: string; summary: string } };
