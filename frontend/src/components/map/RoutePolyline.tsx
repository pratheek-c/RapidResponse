import { useEffect, useRef, useState } from "react";
import { Polyline } from "react-leaflet";

type LatLng = { lat: number; lng: number };
type RouteInfo = { distanceMeters: number; durationSeconds: number };

type Props = {
  from: LatLng;
  to: LatLng;
  onRouteInfo: (info: RouteInfo | null) => void;
};

export function RoutePolyline({ from, to, onRouteInfo }: Props) {
  const [coords, setCoords] = useState<[number, number][]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRouteInfoRef = useRef(onRouteInfo);
  onRouteInfoRef.current = onRouteInfo;

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = (await res.json()) as {
          routes?: {
            geometry: { coordinates: [number, number][] };
            distance: number;
            duration: number;
          }[];
        };
        if (!data.routes?.length) {
          onRouteInfoRef.current(null);
          return;
        }
        const route = data.routes[0]!;
        // GeoJSON is [lng, lat] — Leaflet Polyline needs [lat, lng]
        setCoords(route.geometry.coordinates.map(([lng, lat]) => [lat, lng]));
        onRouteInfoRef.current({
          distanceMeters: route.distance,
          durationSeconds: route.duration,
        });
      } catch {
        onRouteInfoRef.current(null);
      }
    }, 2000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [from.lat, from.lng, to.lat, to.lng]);

  useEffect(() => {
    return () => {
      onRouteInfoRef.current(null);
    };
  }, []);

  if (coords.length === 0) return null;
  return (
    <Polyline
      positions={coords}
      color="#22d3ee"
      weight={3}
      dashArray="6 4"
      opacity={0.85}
    />
  );
}
