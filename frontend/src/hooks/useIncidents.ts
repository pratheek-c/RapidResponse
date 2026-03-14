/**
 * useIncidents — subscribes to SSE /events and maintains live incident list.
 * Also provides a manual fetch to seed the initial list from GET /incidents.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import type { Incident, SseEvent } from "@/types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export function useIncidents() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [connected, setConnected] = useState(false);
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

    es.onmessage = (ev: MessageEvent<string>) => {
      try {
        const event = JSON.parse(ev.data) as SseEvent;
        if (
          event.type === "incident_created" ||
          event.type === "incident_updated" ||
          event.type === "incident_classified"
        ) {
          const updated = event.payload as Incident;
          setIncidents((prev) => {
            const idx = prev.findIndex((i) => i.id === updated.id);
            if (idx === -1) return [updated, ...prev];
            const next = [...prev];
            next[idx] = updated;
            return next;
          });
        }
      } catch {
        // malformed SSE data — ignore
      }
    };

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [fetchAll]);

  return { incidents, connected, refetch: fetchAll };
}
