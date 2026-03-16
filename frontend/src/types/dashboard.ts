export type Department = "patrol" | "fire" | "medical" | "hazmat";

export type IncidentStatus =
  | "active"
  | "classified"
  | "dispatched"
  | "en_route"
  | "on_scene"
  | "completed"
  | "resolved"
  | "cancelled";

export type UnitStatus = "available" | "dispatched" | "on_scene" | "returning";
export type Severity = 1 | 2 | 3 | 4 | 5;
export type Urgency = "low" | "moderate" | "high" | "critical";
export type UnitType = "fire" | "ems" | "police" | "hazmat" | "rescue";
export type ExtractionData = Record<string, string | number | boolean | null>;

export type LocationPoint = {
  lat: number;
  lng: number;
  address: string;
};

export type InjuryInfo = {
  count: number;
  severity: Urgency;
  notes: string;
};

export type HazardInfo = {
  fire: boolean;
  smoke: boolean;
  chemicals: boolean;
  weapon: boolean;
  collapseRisk: boolean;
  notes: string;
};

export type DashboardIncident = {
  id: string;
  cad_number: string | null;
  caller_id: string;
  caller_location: string;
  caller_address: string;
  status: IncidentStatus;
  type: "fire" | "medical" | "police" | "traffic" | "hazmat" | "search_rescue" | "other" | null;
  priority: "P1" | "P2" | "P3" | "P4" | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  s3_audio_prefix: string | null;
  s3_transcript_key: string | null;
  accepted_at: string | null;
  completed_at: string | null;
  escalated: number;
  covert_distress: boolean;
  officer_id: string | null;
  assigned_units: string | null;
  severity: Severity;
  urgency: Urgency;
  summary_line: string;
  location: LocationPoint;
  injuries: InjuryInfo;
  hazards: HazardInfo;
};

export type DashboardUnit = {
  id: string;
  unit_code: string;
  type: UnitType;
  status: UnitStatus;
  current_incident_id: string | null;
  created_at: string;
  updated_at: string;
  department: Department;
  location: Pick<LocationPoint, "lat" | "lng">;
};

export type TranscriptLine = {
  id: string;
  incident_id: string;
  role: "caller" | "agent" | "ai";
  text: string;
  timestamp: string;
};

export type QAEntry = {
  id: string;
  incident_id: string;
  question: string;
  refined_question: string | null;
  answer: string | null;
  asked_at: string;
  answered_at: string | null;
  officer_id: string | null;
};

export type SseIncidentClassifiedEvent = {
  type: "incident_classified";
  data: {
    incident_id: string;
    incident_type: string;
    priority: "P1" | "P2" | "P3" | "P4";
  };
};

export type SseTranscriptUpdateEvent = {
  type: "transcript_update";
  data: {
    incident_id: string;
    role: "caller" | "ai";
    text: string;
    timestamp: string;
  };
};

export type SseExtractionEvent = {
  type: "extraction_update";
  data: {
    incident_id: string;
    extraction: ExtractionData;
  };
};

export type SseAnswerUpdateEvent = {
  type: "answer_update";
  data: {
    incident_id: string;
    question: string;
    answer: string;
  };
};

export type SseUnitDispatchedEvent = {
  type: "unit_dispatched";
  data: {
    incident_id: string;
    unit_id: string;
    unit_type: Department;
  };
};

export type SseStatusChangeEvent = {
  type: "status_change";
  data: {
    incident_id: string;
    status: IncidentStatus;
    unit_id?: string;
  };
};

export type SseEscalationSuggestionEvent = {
  type: "escalation_suggestion";
  data: {
    incident_id: string;
    reason: string;
    suggested_units: Department[];
  };
};

export type SseIncidentCompletedEvent = {
  type: "incident_completed";
  data: {
    incident_id: string;
    summary: string;
  };
};

export type SseCovertDistressEvent = {
  type: "covert_distress";
  data: {
    incident_id: string;
    trigger: string;
    confidence: "high" | "medium";
    silent_approach: boolean;
  };
};

export type SseBackupRequestedEvent = {
  type: "backup_requested";
  data: {
    incident_id: string;
    requesting_unit: string;
    requested_types: string[];
    urgency: string;
    message: string;
  };
};

export type SseBackupAcceptedEvent = {
  type: "backup_accepted";
  data: {
    incident_id: string;
    responding_unit: string;
  };
};

export type SseUnitStatusChangeEvent = {
  type: "unit_status_change";
  data: {
    unit_id: string;
    status: string;
    assigned_incident: string | null;
  };
};

export type TranscriptAnnotation = {
  icon: string;
  label: string;
  color: string;
  timestamp: string; // ISO string, set client-side when received
};

export type SseTranscriptAnnotationEvent = {
  type: "transcript_annotation";
  data: {
    incident_id: string;
    icon: string;
    label: string;
    color: string;
  };
};

export type SseAssignmentSuggestedEvent = {
  type: "assignment_suggested";
  data: {
    incident_id: string;
    suggested_unit: string;
    unit_type: string;
    distance_km: number;
    priority: string;
  };
};

export type SseUnitAutoDispatchedEvent = {
  type: "unit_auto_dispatched";
  data: {
    incident_id: string;
    unit_id: string;
    unit_type: string;
    auto: true;
  };
};

export type SSEEvent =
  | SseIncidentClassifiedEvent
  | SseTranscriptUpdateEvent
  | SseExtractionEvent
  | SseAnswerUpdateEvent
  | SseUnitDispatchedEvent
  | SseStatusChangeEvent
  | SseEscalationSuggestionEvent
  | SseIncidentCompletedEvent
  | SseCovertDistressEvent
  | SseBackupRequestedEvent
  | SseBackupAcceptedEvent
  | SseUnitStatusChangeEvent
  | SseTranscriptAnnotationEvent
  | SseAssignmentSuggestedEvent
  | SseUnitAutoDispatchedEvent;

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiError = { ok: false; error: string };
export type ApiResponse<T> = ApiSuccess<T> | ApiError;
