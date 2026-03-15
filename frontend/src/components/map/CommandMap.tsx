import { useEffect } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from "@/config/constants";
import { mapAttribution, mapTileUrl } from "@/config/mapStyles";
import type { DashboardIncident, DashboardUnit } from "@/types/dashboard";
import { IncidentMarker } from "@/components/map/IncidentMarker";
import { UnitMarker } from "@/components/map/UnitMarker";

type CommandMapProps = {
  incidents: DashboardIncident[];
  units: DashboardUnit[];
  selectedIncidentId: string | null;
  onSelectIncident: (incidentId: string) => void;
};

function MapFocus({ selectedIncident }: { selectedIncident: DashboardIncident | null }) {
  const map = useMap();
  useEffect(() => {
    if (!selectedIncident) return;
    map.flyTo([selectedIncident.location.lat, selectedIncident.location.lng], 14, { duration: 0.7 });
  }, [map, selectedIncident]);
  return null;
}

export function CommandMap({ incidents, units, selectedIncidentId, onSelectIncident }: CommandMapProps) {
  const selectedIncident = incidents.find((incident) => incident.id === selectedIncidentId) ?? null;

  return (
    <div className="h-full w-full overflow-hidden rounded-lg border border-slate-800 shadow-glow">
      <MapContainer center={DEFAULT_MAP_CENTER} zoom={DEFAULT_MAP_ZOOM} className="h-full w-full" zoomControl>
        <TileLayer url={mapTileUrl} attribution={mapAttribution} />
        <MapFocus selectedIncident={selectedIncident} />
        {incidents.map((incident) => (
          <IncidentMarker
            key={incident.id}
            incident={incident}
            selected={incident.id === selectedIncidentId}
            onClick={() => onSelectIncident(incident.id)}
          />
        ))}
        {units.map((unit) => (
          <UnitMarker key={unit.id} unit={unit} />
        ))}
      </MapContainer>
    </div>
  );
}
