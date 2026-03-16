import { Marker, Tooltip } from "react-leaflet";
import L from "leaflet";
import { useEffect } from "react";

type Props = { position: [number, number] };

export function DispatcherMarker({ position }: Props) {
  useEffect(() => {
    if (document.getElementById("disp-marker-style")) return;
    const s = document.createElement("style");
    s.id = "disp-marker-style";
    s.textContent = `@keyframes dispPulse{0%,100%{box-shadow:0 0 0 4px rgba(37,99,235,0.4)}50%{box-shadow:0 0 0 8px rgba(37,99,235,0.1)}}`;
    document.head.appendChild(s);
  }, []);

  const svgPerson = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

  const icon = L.divIcon({
    className: "",
    html: `<div style="width:28px;height:28px;border-radius:50%;background:#2563eb;border:2px solid #fff;box-shadow:0 0 0 4px rgba(37,99,235,0.3);animation:dispPulse 1.5s ease-in-out infinite;display:flex;align-items:center;justify-content:center;color:#fff;">${svgPerson}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

  return (
    <Marker position={position} icon={icon}>
      <Tooltip permanent={false} direction="top" offset={[0, -12]}>
        Your Location
      </Tooltip>
    </Marker>
  );
}
