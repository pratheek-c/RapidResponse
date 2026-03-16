import type { Department } from "@/types/dashboard";

export const DASHBOARD_DEPARTMENTS: Department[] = [
  "patrol",
  "fire",
  "medical",
  "hazmat",
];

// Dublin, Ireland — city centre (O'Connell Bridge area)
export const DEFAULT_MAP_CENTER: [number, number] = [53.3498, -6.2603];
export const DEFAULT_MAP_ZOOM = 13;

// Demo unit positions spread across the Dublin Metropolitan Region
export const DEMO_UNIT_COORDS: Record<string, { lat: number; lng: number }> = {
  "PD-1": { lat: 53.3432, lng: -6.2675 },   // Pearse St Garda Station
  "PD-2": { lat: 53.3558, lng: -6.2598 },   // Store Street Garda Station
  "PD-3": { lat: 53.3381, lng: -6.2946 },   // Kevin Street Garda Station
  "EMS-1": { lat: 53.3527, lng: -6.2788 },  // Jervis Street area
  "EMS-2": { lat: 53.3365, lng: -6.2493 },  // Grand Canal Dock
  "EMS-3": { lat: 53.3612, lng: -6.3002 },  // Phibsborough
  "FD-1": { lat: 53.3478, lng: -6.2695 },   // Tara Street Fire Station
  "FD-2": { lat: 53.3341, lng: -6.2838 },   // Dolphins Barn
  "HAZ-1": { lat: 53.3454, lng: -6.2974 },  // South Circular Road
};
