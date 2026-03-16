import { useEffect, useMemo, useState } from "react";

type DashboardEventType =
  | "incident_created"
  | "incident_classified"
  | "transcript_update"
  | "extraction_update"
  | "answer_update"
  | "unit_dispatched"
  | "status_change"
  | "escalation_suggestion"
  | "incident_completed"
  | "covert_distress"
  | "backup_requested"
  | "backup_accepted"
  | "unit_status_change";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export type SseEnvelope = {
  type: DashboardEventType;
  data: unknown;
};

const EVENT_TYPES: DashboardEventType[] = [
  "incident_created",
  "incident_classified",
  "transcript_update",
  "extraction_update",
  "answer_update",
  "unit_dispatched",
  "status_change",
  "escalation_suggestion",
  "incident_completed",
  "covert_distress",
  "backup_requested",
  "backup_accepted",
  "unit_status_change",
];

export function useSSE() {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SseEnvelope | null>(null);

  useEffect(() => {
    const source = new EventSource(`${API_BASE}/events`);

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    const listeners = EVENT_TYPES.map((eventType) => {
      const handler = (event: MessageEvent<string>) => {
        try {
          const parsed = JSON.parse(event.data) as unknown;
          setLastEvent({ type: eventType, data: parsed });
        } catch {
          // ignore malformed event
        }
      };
      source.addEventListener(eventType, handler);
      return { eventType, handler };
    });

    return () => {
      for (const listener of listeners) {
        source.removeEventListener(listener.eventType, listener.handler);
      }
      source.close();
      setConnected(false);
    };
  }, []);

  return useMemo(() => ({ connected, lastEvent }), [connected, lastEvent]);
}
