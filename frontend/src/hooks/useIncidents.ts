/**
 * useIncidents — subscribes to SSE /events and maintains live incident list,
 * per-incident extraction state, and escalation suggestions.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import type {
  Incident,
  SseEvent,
  ExtractionData,
  EscalationSuggestion,
} from "@/types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export function useIncidents() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [connected, setConnected] = useState(false);
  // Keyed by incident_id
  const [extractions, setExtractions] = useState<Record<string, ExtractionData>>({});
  const [escalations, setEscalations] = useState<Record<string, EscalationSuggestion>>({});
  const esRef = useRef<EventSource | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/incidents`);
      if (!res.ok) return;
      const json = (await res.json()) as { ok: boolean; data: Incident[] };
      if (json.ok) setIncidents(json.data);
    } catch {
      // non-fatal — SSE will keep us up to date
    }
  }, []);

  useEffect(() => {
    void fetchAll();

    const es = new EventSource(`${API_BASE}/events`);
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    // ---- Helpers ----
    const upsertIncident = (updated: Incident) => {
      setIncidents((prev) => {
        const idx = prev.findIndex((i) => i.id === updated.id);
        if (idx === -1) return [updated, ...prev];
        const next = [...prev];
        next[idx] = updated;
        return next;
      });
    };

    // ---- Legacy incident events (payload IS the Incident directly, except classified) ----
    const handleIncidentEvent = (ev: MessageEvent<string>) => {
      try {
        const event = JSON.parse(ev.data) as SseEvent;
        const payload = event.payload as Record<string, unknown>;
        const updated: Incident =
          event.type === "incident_classified" && payload["incident"]
            ? (payload["incident"] as Incident)
            : (payload as unknown as Incident);
        upsertIncident(updated);
      } catch {
        // malformed SSE data — ignore
      }
    };

    es.addEventListener("incident_created", handleIncidentEvent);
    es.addEventListener("incident_updated", handleIncidentEvent);
    es.addEventListener("incident_classified", handleIncidentEvent);

    // ---- New dashboard SSE events ----

    // status_change — update incident status in list
    es.addEventListener("status_change", (ev: MessageEvent<string>) => {
      try {
        const event = JSON.parse(ev.data) as SseEvent;
        const payload = event.payload as { incident_id: string; status: Incident["status"]; incident?: Incident };
        if (payload.incident) {
          upsertIncident(payload.incident);
        } else {
          setIncidents((prev) =>
            prev.map((i) =>
              i.id === payload.incident_id ? { ...i, status: payload.status } : i
            )
          );
        }
      } catch {
        // ignore
      }
    });

    // incident_completed — update status + summary
    es.addEventListener("incident_completed", (ev: MessageEvent<string>) => {
      try {
        const event = JSON.parse(ev.data) as SseEvent;
        const payload = event.payload as { incident_id: string; summary: string };
        setIncidents((prev) =>
          prev.map((i) =>
            i.id === payload.incident_id
              ? { ...i, status: "completed", summary: payload.summary }
              : i
          )
        );
      } catch {
        // ignore
      }
    });

    // extraction_update — store per-incident extraction data
    es.addEventListener("extraction_update", (ev: MessageEvent<string>) => {
      try {
        const event = JSON.parse(ev.data) as SseEvent;
        const payload = event.payload as { incident_id: string; extraction: ExtractionData };
        setExtractions((prev) => ({
          ...prev,
          [payload.incident_id]: payload.extraction,
        }));
      } catch {
        // ignore
      }
    });

    // escalation_suggestion — store latest suggestion per incident
    es.addEventListener("escalation_suggestion", (ev: MessageEvent<string>) => {
      try {
        const event = JSON.parse(ev.data) as SseEvent;
        const payload = event.payload as EscalationSuggestion;
        setEscalations((prev) => ({
          ...prev,
          [payload.incident_id]: payload,
        }));
      } catch {
        // ignore
      }
    });

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [fetchAll]);

  return { incidents, connected, extractions, escalations, refetch: fetchAll };
}
