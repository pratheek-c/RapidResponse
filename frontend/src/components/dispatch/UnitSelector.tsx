import { useMemo } from "react";
import { Zap } from "lucide-react";
import type { DashboardUnit } from "@/types/dashboard";

type UnitSelectorProps = {
  units: DashboardUnit[];
  selectedUnitIds: string[];
  onToggle: (unitId: string) => void;
  /** If provided, units are sorted by proximity to this lat/lng */
  incidentLat?: number;
  incidentLng?: number;
};

const UNIT_TYPE_LABELS: Record<string, string> = {
  fire: "DFB",
  ems: "NAS",
  police: "GARDA",
  hazmat: "HAZMAT",
  rescue: "SAR",
};

const UNIT_TYPE_COLORS: Record<string, string> = {
  fire: "text-orange-300",
  ems: "text-emerald-300",
  police: "text-blue-300",
  hazmat: "text-purple-300",
  rescue: "text-sky-300",
};

const STATUS_LABELS: Record<string, string> = {
  available: "Available",
  dispatched: "Dispatched",
  on_scene: "On Scene",
  returning: "Returning",
};

const STATUS_DOT: Record<string, string> = {
  available: "bg-emerald-400",
  dispatched: "bg-orange-400",
  on_scene: "bg-blue-400",
  returning: "bg-purple-400",
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function etaMinutes(distKm: number): number {
  // Average emergency vehicle speed in urban Dublin: ~35 km/h
  return Math.ceil((distKm / 35) * 60);
}

export function UnitSelector({
  units,
  selectedUnitIds,
  onToggle,
  incidentLat,
  incidentLng,
}: UnitSelectorProps) {
  const ranked = useMemo(() => {
    const hasCoords = incidentLat !== undefined && incidentLng !== undefined;

    return [...units]
      .map((unit) => {
        const distKm =
          hasCoords && unit.location
            ? haversineKm(incidentLat!, incidentLng!, unit.location.lat, unit.location.lng)
            : null;
        return { unit, distKm };
      })
      .sort((a, b) => {
        // 1. Available units first
        const aAvail = a.unit.status === "available" ? 0 : 1;
        const bAvail = b.unit.status === "available" ? 0 : 1;
        if (aAvail !== bAvail) return aAvail - bAvail;
        // 2. Sort by distance if available
        if (a.distKm !== null && b.distKm !== null) return a.distKm - b.distKm;
        return 0;
      });
  }, [units, incidentLat, incidentLng]);

  const available = ranked.filter((r) => r.unit.status === "available");
  const unavailable = ranked.filter((r) => r.unit.status !== "available");

  // Auto-assign: pick the first available (closest) unit
  function handleAutoAssign() {
    if (available.length === 0) return;
    const best = available[0].unit;
    if (!selectedUnitIds.includes(best.id)) {
      onToggle(best.id);
    }
  }

  if (ranked.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-slate-700 p-3 text-center text-xs text-slate-500">
        No units in system.
      </p>
    );
  }

  return (
    <div>
      {/* Auto-assign button */}
      {available.length > 0 && (
        <button
          type="button"
          onClick={handleAutoAssign}
          className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-emerald-700/60 bg-emerald-950/40 px-2 py-1.5 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-950/60"
          title="Auto-select nearest available unit"
        >
          <Zap className="h-3.5 w-3.5" />
          Auto-Assign Best Match
          {available[0].distKm !== null && (
            <span className="ml-1 font-normal opacity-70">
              — {available[0].unit.unit_code} ({available[0].distKm.toFixed(1)} km)
            </span>
          )}
        </button>
      )}

      {/* Available units */}
      <div className="space-y-1.5">
        {available.map(({ unit, distKm }) => {
          const selected = selectedUnitIds.includes(unit.id);
          const eta = distKm !== null ? etaMinutes(distKm) : null;
          return (
            <button
              key={unit.id}
              type="button"
              onClick={() => onToggle(unit.id)}
              className={`w-full rounded-md border px-2.5 py-2 text-left text-xs transition-colors ${
                selected
                  ? "border-emerald-500/70 bg-emerald-500/15 text-emerald-100"
                  : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[unit.status] ?? "bg-slate-500"}`}
                  />
                  <span className="font-mono font-bold text-slate-100">{unit.unit_code}</span>
                  <span
                    className={`text-[9px] font-bold uppercase tracking-wider ${
                      UNIT_TYPE_COLORS[unit.type] ?? "text-slate-400"
                    }`}
                  >
                    {UNIT_TYPE_LABELS[unit.type] ?? unit.type.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-right">
                  {distKm !== null && (
                    <span className="font-mono text-[10px] text-slate-400">
                      {distKm.toFixed(1)} km
                    </span>
                  )}
                  {eta !== null && (
                    <span className="rounded border border-slate-700 bg-slate-800 px-1 text-[10px] text-slate-300">
                      ~{eta} min
                    </span>
                  )}
                  {selected && (
                    <span className="text-[10px] font-bold text-emerald-400">SEL</span>
                  )}
                </div>
              </div>
              <div className="mt-0.5 text-[10px] text-slate-500">
                {STATUS_LABELS[unit.status] ?? unit.status}
              </div>
            </button>
          );
        })}
      </div>

      {/* Unavailable units — collapsed hint */}
      {unavailable.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[10px] text-slate-500 hover:text-slate-400">
            {unavailable.length} unit{unavailable.length !== 1 ? "s" : ""} unavailable (dispatched / on scene)
          </summary>
          <div className="mt-1.5 space-y-1">
            {unavailable.map(({ unit, distKm }) => (
              <div
                key={unit.id}
                className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/40 px-2.5 py-1.5 text-xs opacity-50"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[unit.status] ?? "bg-slate-600"}`}
                  />
                  <span className="font-mono text-slate-300">{unit.unit_code}</span>
                  <span className="text-[9px] text-slate-500">
                    {UNIT_TYPE_LABELS[unit.type] ?? unit.type.toUpperCase()}
                  </span>
                </div>
                <span className="text-[10px] text-slate-500">
                  {STATUS_LABELS[unit.status] ?? unit.status}
                  {distKm !== null && ` · ${distKm.toFixed(1)} km`}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {available.length === 0 && unavailable.length === 0 && (
        <p className="text-xs text-slate-500">No units available.</p>
      )}
    </div>
  );
}
