import L from "leaflet";
import { Marker, Tooltip } from "react-leaflet";
import type { DashboardIncident } from "@/types/dashboard";

type IncidentMarkerProps = {
  incident: DashboardIncident;
  selected: boolean;
  onClick: () => void;
};

function severityColor(severity: DashboardIncident["severity"]): string {
  if (severity === 5) return "#ef4444";
  if (severity === 4) return "#f97316";
  if (severity === 3) return "#eab308";
  if (severity === 2) return "#3b82f6";
  return "#22c55e";
}

function createIncidentIcon(color: string, selected: boolean): L.DivIcon {
  const ring = selected ? "0 0 0 6px rgba(59,130,246,0.35)" : "0 0 0 3px rgba(15,23,42,0.6)";
  return L.divIcon({
    className: "incident-marker",
    html: `<div style="width:16px;height:16px;border-radius:9999px;background:${color};border:2px solid #0f172a;box-shadow:${ring};"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export function IncidentMarker({ incident, selected, onClick }: IncidentMarkerProps) {
  return (
    <Marker
      position={[incident.location.lat, incident.location.lng]}
      icon={createIncidentIcon(severityColor(incident.severity), selected)}
      eventHandlers={{ click: onClick }}
    >
      <Tooltip direction="top" offset={[0, -8]}>
        {incident.id.slice(0, 8)} · {incident.summary_line}
      </Tooltip>
    </Marker>
  );
}
