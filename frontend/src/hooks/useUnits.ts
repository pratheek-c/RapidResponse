/**
 * useUnits — fetches and caches the list of dispatch units.
 * Refreshes on a 10-second interval to pick up status changes.
 */
import { useEffect, useState, useCallback } from "react";
import type { Unit } from "@/types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export function useUnits() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);

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
    return () => clearInterval(id);
  }, [fetchAll]);

  return { units, loading, refetch: fetchAll };
}
