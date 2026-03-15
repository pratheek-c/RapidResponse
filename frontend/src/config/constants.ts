import type { Department } from "@/types/dashboard";

export const DASHBOARD_DEPARTMENTS: Department[] = [
  "patrol",
  "fire",
  "medical",
  "hazmat",
];

export const DEFAULT_MAP_CENTER: [number, number] = [39.7817, -89.6501];
export const DEFAULT_MAP_ZOOM = 12;

export const DEMO_UNIT_COORDS: Record<string, { lat: number; lng: number }> = {
  "PD-1": { lat: 39.7922, lng: -89.6406 },
  "PD-2": { lat: 39.7693, lng: -89.6628 },
  "PD-3": { lat: 39.8025, lng: -89.6882 },
  "EMS-1": { lat: 39.7792, lng: -89.6359 },
  "EMS-2": { lat: 39.7548, lng: -89.6495 },
  "EMS-3": { lat: 39.7717, lng: -89.6895 },
  "FD-1": { lat: 39.7914, lng: -89.6577 },
  "FD-2": { lat: 39.7631, lng: -89.6768 },
  "HAZ-1": { lat: 39.7849, lng: -89.7012 },
};
