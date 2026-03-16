import { useCallback, useEffect, useMemo, useState } from "react";
import type { TranscriptAnnotation } from "@/types/dashboard";

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
  | "unit_status_change"
  | "transcript_annotation"
  | "assignment_suggested"
  | "unit_auto_dispatched";

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
  "transcript_annotation",
  "assignment_suggested",
  "unit_auto_dispatched",
];

export function useSSE() {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SseEnvelope | null>(null);
  const [annotations, setAnnotations] = useState<Map<string, TranscriptAnnotation[]>>(new Map());

  useEffect(() => {
    const source = new EventSource(`${API_BASE}/events`);

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    const listeners = EVENT_TYPES.map((eventType) => {
      const handler = (event: MessageEvent<string>) => {
        try {
          const parsed = JSON.parse(event.data) as unknown;

          if (eventType === "transcript_annotation") {
            const data = parsed as { incident_id: string; icon: string; label: string; color: string };
            const annotation: TranscriptAnnotation = {
              icon: data.icon,
              label: data.label,
              color: data.color,
              timestamp: new Date().toISOString(),
            };
            setAnnotations((prev) => {
              const next = new Map(prev);
              const existing = next.get(data.incident_id) ?? [];
              next.set(data.incident_id, [...existing, annotation]);
              return next;
            });
          } else {
            setLastEvent({ type: eventType, data: parsed });
          }
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

  const getAnnotations = useCallback(
    (incident_id: string): TranscriptAnnotation[] => annotations.get(incident_id) ?? [],
    [annotations]
  );

  return useMemo(
    () => ({ connected, lastEvent, getAnnotations }),
    [connected, lastEvent, getAnnotations]
  );
}
