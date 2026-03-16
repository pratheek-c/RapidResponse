import { useCallback, useEffect, useMemo, useState } from "react";
import { useSSE } from "@/hooks/useSSE";
import type {
  ApiResponse,
  DashboardIncident,
  ExtractionData,
  IncidentStatus,
  Severity,
  SseEscalationSuggestionEvent,
  SseExtractionEvent,
} from "@/types/dashboard";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

type EscalationMap = Record<string, SseEscalationSuggestionEvent["data"]>;
type ExtractionMap = Record<string, ExtractionData>;

function parseCoords(callerLocation: string): { lat: number; lng: number } {
  const [latRaw, lngRaw] = callerLocation.split(",").map((value) => value.trim());
  const lat = Number.parseFloat(latRaw ?? "");
  const lng = Number.parseFloat(lngRaw ?? "");
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }
  return { lat: 39.7817, lng: -89.6501 };
}

function priorityToSeverity(priority: DashboardIncident["priority"]): Severity {
  if (priority === "P1") return 5;
  if (priority === "P2") return 4;
  if (priority === "P3") return 3;
  return 2;
}

function normalizeIncident(input: DashboardIncident & { covert_distress?: number | boolean }): DashboardIncident {
  const coords = parseCoords(input.caller_location);
  return {
    ...input,
    covert_distress: Boolean(input.covert_distress),
    severity: input.severity ?? priorityToSeverity(input.priority),
    urgency: input.urgency ?? (input.priority === "P1" ? "critical" : "high"),
    summary_line: input.summary_line ?? input.summary ?? "Live incident in progress",
    location: input.location ?? {
      lat: coords.lat,
      lng: coords.lng,
      address: input.caller_address,
    },
    injuries: input.injuries ?? {
      count: 0,
      severity: "low",
      notes: "No injuries reported yet",
    },
    hazards: input.hazards ?? {
      fire: false,
      smoke: false,
      chemicals: false,
      weapon: false,
      collapseRisk: false,
      notes: "No major hazards reported",
    },
  };
}

function mergeExtraction(incident: DashboardIncident, extraction: ExtractionData): DashboardIncident {
  const lat = typeof extraction["lat"] === "number" ? extraction["lat"] : incident.location.lat;
  const lng = typeof extraction["lng"] === "number" ? extraction["lng"] : incident.location.lng;
  const summaryLine =
    typeof extraction["summary_line"] === "string" ? extraction["summary_line"] : incident.summary_line;
  const injuriesCount =
    typeof extraction["injury_count"] === "number" ? extraction["injury_count"] : incident.injuries.count;
  const injuryNotes =
    typeof extraction["injury_notes"] === "string" ? extraction["injury_notes"] : incident.injuries.notes;
  const hazardNotes =
    typeof extraction["hazard_notes"] === "string" ? extraction["hazard_notes"] : incident.hazards.notes;

  return {
    ...incident,
    summary_line: summaryLine,
    location: {
      ...incident.location,
      lat,
      lng,
    },
    injuries: {
      ...incident.injuries,
      count: injuriesCount,
      notes: injuryNotes,
    },
    hazards: {
      ...incident.hazards,
      fire: typeof extraction["hazard_fire"] === "boolean" ? extraction["hazard_fire"] : incident.hazards.fire,
      smoke: typeof extraction["hazard_smoke"] === "boolean" ? extraction["hazard_smoke"] : incident.hazards.smoke,
      chemicals:
        typeof extraction["hazard_chemicals"] === "boolean"
          ? extraction["hazard_chemicals"]
          : incident.hazards.chemicals,
      weapon:
        typeof extraction["hazard_weapon"] === "boolean" ? extraction["hazard_weapon"] : incident.hazards.weapon,
      collapseRisk:
        typeof extraction["hazard_collapse"] === "boolean"
          ? extraction["hazard_collapse"]
          : incident.hazards.collapseRisk,
      notes: hazardNotes,
    },
  };
}

export function useIncidents() {
  const [incidents, setIncidents] = useState<DashboardIncident[]>([]);
  const [extractions, setExtractions] = useState<ExtractionMap>({});
  const [escalations, setEscalations] = useState<EscalationMap>({});
  const { connected, lastEvent } = useSSE();

  const fetchAll = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/incidents`);
      if (!response.ok) return;
      const payload = (await response.json()) as ApiResponse<DashboardIncident[]>;
      if (!payload.ok) return;
      setIncidents(payload.data.map(normalizeIncident));
    } catch {
      // non-fatal for live dashboard
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (!lastEvent) return;

    if (lastEvent.type === "incident_created") {
      const data = lastEvent.data as { incident_id: string };
      void (async () => {
        try {
          const response = await fetch(`${API_BASE}/incidents/${data.incident_id}`);
          if (!response.ok) return;
          const payload = (await response.json()) as ApiResponse<DashboardIncident>;
          if (!payload.ok) return;
          const normalized = normalizeIncident(payload.data);
          setIncidents((prev) => {
            if (prev.some((i) => i.id === normalized.id)) return prev;
            return [normalized, ...prev];
          });
        } catch {
          // non-fatal
        }
      })();
      return;
    }

    if (lastEvent.type === "status_change") {
      const data = lastEvent.data as { incident_id: string; status: IncidentStatus };
      setIncidents((prev) =>
        prev.map((incident) =>
          incident.id === data.incident_id ? { ...incident, status: data.status } : incident
        )
      );
      return;
    }

    if (lastEvent.type === "incident_completed") {
      const data = lastEvent.data as { incident_id: string; summary: string };
      setIncidents((prev) =>
        prev.map((incident) =>
          incident.id === data.incident_id
            ? { ...incident, status: "completed", summary: data.summary, summary_line: data.summary }
            : incident
        )
      );
      return;
    }

    if (lastEvent.type === "incident_classified") {
      const data = lastEvent.data as { incident_id: string; incident_type: DashboardIncident["type"]; priority: DashboardIncident["priority"] };
      setIncidents((prev) =>
        prev.map((incident) =>
          incident.id === data.incident_id
            ? {
                ...incident,
                type: data.incident_type,
                priority: data.priority,
                severity: priorityToSeverity(data.priority),
              }
            : incident
        )
      );
      return;
    }

    if (lastEvent.type === "extraction_update") {
      const extractionEvent = { type: "extraction_update", data: lastEvent.data } as SseExtractionEvent;
      setExtractions((prev) => ({ ...prev, [extractionEvent.data.incident_id]: extractionEvent.data.extraction }));
      setIncidents((prev) =>
        prev.map((incident) =>
          incident.id === extractionEvent.data.incident_id
            ? mergeExtraction(incident, extractionEvent.data.extraction)
            : incident
        )
      );
      return;
    }

    if (lastEvent.type === "escalation_suggestion") {
      const escalationEvent = { type: "escalation_suggestion", data: lastEvent.data } as SseEscalationSuggestionEvent;
      setEscalations((prev) => ({ ...prev, [escalationEvent.data.incident_id]: escalationEvent.data }));
      return;
    }

    if (lastEvent.type === "covert_distress") {
      const evData = lastEvent.data as { incident_id: string };
      setIncidents((prev) =>
        prev.map((inc) =>
          inc.id === evData.incident_id
            ? { ...inc, covert_distress: true }
            : inc
        )
      );
    }
  }, [lastEvent]);

  const sortedIncidents = useMemo(
    () =>
      [...incidents].sort((a, b) => {
        if (b.severity !== a.severity) return b.severity - a.severity;
        return Date.parse(b.created_at) - Date.parse(a.created_at);
      }),
    [incidents]
  );

  return {
    incidents: sortedIncidents,
    connected,
    extractions,
    escalations,
    refetch: fetchAll,
  };
}
