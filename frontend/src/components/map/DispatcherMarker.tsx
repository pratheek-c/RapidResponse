import { Marker, Tooltip } from "react-leaflet";
import L from "leaflet";
import { useEffect } from "react";

type Props = { position: [number, number] };

export function DispatcherMarker({ position }: Props) {
  useEffect(() => {
    if (document.getElementById("disp-marker-style")) return;
    const s = document.createElement("style");
    s.id = "disp-marker-style";
    s.textContent = `@keyframes dispPulse{0%,100%{box-shadow:0 0 0 4px rgba(34,211,238,0.4)}50%{box-shadow:0 0 0 8px rgba(34,211,238,0.1)}}`;
    document.head.appendChild(s);
  }, []);

  const icon = L.divIcon({
    className: "",
    html: `<div style="width:18px;height:18px;border-radius:50%;background:#22d3ee;border:3px solid #fff;box-shadow:0 0 0 4px rgba(34,211,238,0.3);animation:dispPulse 1.5s ease-in-out infinite;"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

  return (
    <Marker position={position} icon={icon}>
      <Tooltip permanent={false} direction="top" offset={[0, -12]}>
        Your Location
      </Tooltip>
    </Marker>
  );
}
