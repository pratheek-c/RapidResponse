import { useCallback, useEffect, useMemo, useState } from "react";
import { DEMO_UNIT_COORDS, DEFAULT_MAP_CENTER } from "@/config/constants";
import { useSSE } from "@/hooks/useSSE";
import type { ApiResponse, DashboardUnit, Department, UnitType } from "@/types/dashboard";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

type UnitRow = {
  id: string;
  unit_code: string;
  type: UnitType;
  status: DashboardUnit["status"];
  current_incident_id: string | null;
  created_at: string;
  updated_at: string;
};

function mapDepartment(type: UnitType): Department {
  if (type === "police") return "patrol";
  if (type === "ems") return "medical";
  if (type === "hazmat") return "hazmat";
  return "fire";
}

function normalizeUnit(unit: UnitRow): DashboardUnit {
  const fallback = {
    lat: DEFAULT_MAP_CENTER[0],
    lng: DEFAULT_MAP_CENTER[1],
  };
  const coord = DEMO_UNIT_COORDS[unit.unit_code] ?? fallback;
  return {
    ...unit,
    department: mapDepartment(unit.type),
    location: coord,
  };
}

export function useUnits() {
  const [units, setUnits] = useState<DashboardUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const { lastEvent } = useSSE();

  const fetchAll = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/units`);
      if (!response.ok) return;
      const payload = (await response.json()) as ApiResponse<UnitRow[]>;
      if (!payload.ok) return;
      setUnits(payload.data.map(normalizeUnit));
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
    const intervalId = setInterval(() => void fetchAll(), 10_000);
    return () => clearInterval(intervalId);
  }, [fetchAll]);

  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.type !== "unit_dispatched") return;
    void fetchAll();
  }, [lastEvent, fetchAll]);

  const availableCount = useMemo(
    () => units.filter((unit) => unit.status === "available").length,
    [units]
  );

  return { units, loading, availableCount, refetch: fetchAll };
}
