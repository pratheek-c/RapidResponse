import L from "leaflet";
import { Marker, Tooltip } from "react-leaflet";
import type { DashboardUnit } from "@/types/dashboard";

type UnitMarkerProps = {
  unit: DashboardUnit;
  isOwnUnit?: boolean;
};

function statusColor(status: DashboardUnit["status"]): string {
  if (status === "available") return "#22c55e";
  if (status === "dispatched") return "#f59e0b";
  if (status === "on_scene") return "#8b5cf6";
  return "#38bdf8";
}

function buildIcon(color: string, isOwnUnit: boolean): L.DivIcon {
  const pingRing = isOwnUnit
    ? `<div style="position:absolute;inset:-6px;border-radius:9999px;border:2px solid ${color};opacity:0.75;animation:ping 1s cubic-bezier(0,0,0.2,1) infinite;"></div>`
    : "";
  return L.divIcon({
    className: "unit-marker",
    html: `<div style="position:relative;width:${isOwnUnit ? 18 : 14}px;height:${isOwnUnit ? 18 : 14}px;">
      ${pingRing}
      <div style="width:100%;height:100%;border-radius:9999px;border:${isOwnUnit ? 3 : 2}px solid #0f172a;background:${color};box-shadow:0 0 0 4px rgba(15,23,42,0.5);${isOwnUnit ? `outline:2px solid ${color};outline-offset:3px;` : ""}"></div>
    </div>`,
    iconSize: [isOwnUnit ? 18 : 14, isOwnUnit ? 18 : 14],
    iconAnchor: [isOwnUnit ? 9 : 7, isOwnUnit ? 9 : 7],
  });
}

export function UnitMarker({ unit, isOwnUnit = false }: UnitMarkerProps) {
  return (
    <Marker
      position={[unit.location.lat, unit.location.lng]}
      icon={buildIcon(statusColor(unit.status), isOwnUnit)}
    >
      <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
        {isOwnUnit ? "YOU · " : ""}{unit.unit_code} · {unit.status}
      </Tooltip>
    </Marker>
  );
}
