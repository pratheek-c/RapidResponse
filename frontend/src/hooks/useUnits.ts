/**
 * useUnits — fetches and caches the list of dispatch units.
 * Refreshes on a 10-second interval AND instantly on SSE unit_dispatched events.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import type { Unit, SseEvent } from "@/types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export function useUnits() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const esRef = useRef<EventSource | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/units`);
      if (!res.ok) return;
      const json = (await res.json()) as { ok: boolean; data: Unit[] };
      if (json.ok) setUnits(json.data);
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
    const id = setInterval(() => void fetchAll(), 10_000);

    // Also listen for unit_dispatched SSE events to update instantly
    const es = new EventSource(`${API_BASE}/events`);
    esRef.current = es;

    const handleUnitDispatched = (ev: MessageEvent<string>) => {
      try {
        const event = JSON.parse(ev.data) as SseEvent;
        const updatedUnit = event.payload as Unit;
        setUnits((prev) => {
          const idx = prev.findIndex((u) => u.id === updatedUnit.id);
          if (idx === -1) return prev; // unknown unit — refetch
          const next = [...prev];
          next[idx] = updatedUnit;
          return next;
        });
      } catch {
        // malformed SSE — fall back to next poll
      }
    };

    es.addEventListener("unit_dispatched", handleUnitDispatched);

    return () => {
      clearInterval(id);
      es.close();
      esRef.current = null;
    };
  }, [fetchAll]);

  return { units, loading, refetch: fetchAll };
}
