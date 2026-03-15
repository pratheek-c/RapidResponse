import L from "leaflet";
import { Marker, Tooltip } from "react-leaflet";
import type { DashboardUnit } from "@/types/dashboard";

type UnitMarkerProps = {
  unit: DashboardUnit;
};

function statusColor(status: DashboardUnit["status"]): string {
  if (status === "available") return "#22c55e";
  if (status === "dispatched") return "#f59e0b";
  if (status === "on_scene") return "#8b5cf6";
  return "#38bdf8";
}

function buildIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "unit-marker",
    html: `<div style="width:14px;height:14px;border-radius:9999px;border:2px solid #0f172a;background:${color};box-shadow:0 0 0 4px rgba(15,23,42,0.5);"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

export function UnitMarker({ unit }: UnitMarkerProps) {
  return (
    <Marker position={[unit.location.lat, unit.location.lng]} icon={buildIcon(statusColor(unit.status))}>
      <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
        {unit.unit_code} · {unit.status}
      </Tooltip>
    </Marker>
  );
}
