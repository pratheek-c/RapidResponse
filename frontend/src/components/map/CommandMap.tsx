import { useEffect } from "react";
import { MapContainer, useMap } from "react-leaflet";
import { vectorBasemapLayer } from "esri-leaflet-vector";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from "@/config/constants";
import type { DashboardIncident, DashboardUnit } from "@/types/dashboard";
import { IncidentMarker } from "@/components/map/IncidentMarker";
import { UnitMarker } from "@/components/map/UnitMarker";
import { DispatcherMarker } from "@/components/map/DispatcherMarker";
import { RoutePolyline } from "@/components/map/RoutePolyline";

const ARCGIS_API_KEY = import.meta.env.VITE_ARCGIS_API_KEY as string | undefined;

// ---------------------------------------------------------------------------
// Esri vector basemap — replaces OSM/Carto tile layer.
// Uses "arcgis/navigation" dark style which maximises contrast for incident
// markers and unit icons on a dispatch screen.
// Falls back to a plain dark CartoCDN raster if the API key is absent.
// ---------------------------------------------------------------------------
function EsriVectorBasemap() {
  const map = useMap();

  useEffect(() => {
    if (!ARCGIS_API_KEY) {
      // Fallback: add CartoCDN dark raster when no Esri key is configured
      const L = (window as unknown as { L: typeof import("leaflet") }).L;
      if (L) {
        L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
          attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
          maxZoom: 19,
        }).addTo(map);
      }
      return;
    }

    const layer = vectorBasemapLayer("arcgis/navigation", {
      apiKey: ARCGIS_API_KEY,
      version: 2,
    });
    layer.addTo(map);
    return () => {
      map.removeLayer(layer);
    };
  }, [map]);

  return null;
}

// ---------------------------------------------------------------------------
// Fly to selected incident
// ---------------------------------------------------------------------------
function MapFocus({ selectedIncident }: { selectedIncident: DashboardIncident | null }) {
  const map = useMap();
  useEffect(() => {
    if (!selectedIncident) return;
    map.flyTo(
      [selectedIncident.location.lat, selectedIncident.location.lng],
      14,
      { duration: 0.7 }
    );
  }, [map, selectedIncident]);
  return null;
}

// ---------------------------------------------------------------------------
// CommandMap
// ---------------------------------------------------------------------------
type LatLng = { lat: number; lng: number };

type CommandMapProps = {
  incidents: DashboardIncident[];
  units: DashboardUnit[];
  selectedIncidentId: string | null;
  onSelectIncident: (incidentId: string) => void;
  dispatcherLocation?: LatLng | null;
  onRouteInfo?: (info: { distanceMeters: number; durationSeconds: number } | null) => void;
};

export function CommandMap({
  incidents,
  units,
  selectedIncidentId,
  onSelectIncident,
  dispatcherLocation,
  onRouteInfo,
}: CommandMapProps) {
  const selectedIncident = incidents.find((i) => i.id === selectedIncidentId) ?? null;

  return (
    <div className="h-full w-full overflow-hidden rounded-lg border border-slate-800 shadow-glow">
      <MapContainer
        center={DEFAULT_MAP_CENTER}
        zoom={DEFAULT_MAP_ZOOM}
        maxZoom={19}
        className="h-full w-full"
        zoomControl
      >
        <EsriVectorBasemap />
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
        {dispatcherLocation != null && (
          <DispatcherMarker
            position={[dispatcherLocation.lat, dispatcherLocation.lng]}
          />
        )}
        {dispatcherLocation != null && selectedIncident != null && (
          <RoutePolyline
            from={dispatcherLocation}
            to={{
              lat: selectedIncident.location.lat,
              lng: selectedIncident.location.lng,
            }}
            onRouteInfo={onRouteInfo ?? (() => {})}
          />
        )}
      </MapContainer>
    </div>
  );
}
