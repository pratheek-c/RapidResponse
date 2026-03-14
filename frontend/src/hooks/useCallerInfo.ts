/**
 * useCallerInfo
 *
 * Automatically collects three pieces of caller metadata from the browser:
 *
 *  1. callerId   — a persistent UUID stored in localStorage under "rr_caller_id".
 *                  Survives page refreshes; uniquely identifies this browser session.
 *
 *  2. coords     — GPS coordinates from navigator.geolocation (lat/lng as strings).
 *                  Formatted as "lat, lng" for the Nova Sonic location field.
 *
 *  3. address    — human-readable street address reverse-geocoded from the GPS
 *                  coordinates using the OpenStreetMap Nominatim API (no API key).
 *                  Falls back to the raw "lat, lng" string if geocoding fails.
 *
 * The hook requests geolocation on mount.  The caller page can display
 * detection status and let the user override any field before placing the call.
 */

import { useCallback, useEffect, useState } from "react";

export type GeoStatus =
  | "idle"
  | "requesting"
  | "granted"
  | "denied"
  | "unavailable"
  | "error";

export type CallerInfo = {
  callerId: string;
  coords: string;           // "lat, lng"  (empty string if not yet determined)
  address: string;          // reverse-geocoded address (empty string if not yet determined)
  geoStatus: GeoStatus;
  geoError: string | null;
  requestLocation: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = "rr_caller_id";

function getOrCreateCallerId(): string {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const id = `CALLER-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  localStorage.setItem(STORAGE_KEY, id);
  return id;
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const url =
    `https://nominatim.openstreetmap.org/reverse` +
    `?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;

  const res = await fetch(url, {
    headers: {
      // Nominatim requires a User-Agent identifying the app
      "Accept-Language": "en",
    },
  });

  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);

  type NominatimResult = {
    display_name?: string;
    address?: {
      house_number?: string;
      road?: string;
      neighbourhood?: string;
      suburb?: string;
      city?: string;
      town?: string;
      village?: string;
      county?: string;
      state?: string;
      postcode?: string;
      country?: string;
    };
  };

  const data = (await res.json()) as NominatimResult;

  // Build a concise address: "house_number road, city/town, state postcode"
  const a = data.address;
  if (a) {
    const parts: string[] = [];
    const street = [a.house_number, a.road].filter(Boolean).join(" ");
    if (street) parts.push(street);
    const city = a.city ?? a.town ?? a.village ?? a.suburb ?? a.neighbourhood;
    if (city) parts.push(city);
    if (a.state) parts.push(a.state);
    if (a.postcode) parts.push(a.postcode);
    if (parts.length > 0) return parts.join(", ");
  }

  // Fall back to Nominatim's full display_name
  return data.display_name ?? `${lat}, ${lng}`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCallerInfo(): CallerInfo {
  const [callerId] = useState<string>(() => getOrCreateCallerId());
  const [coords, setCoords] = useState<string>("");
  const [address, setAddress] = useState<string>("");
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("idle");
  const [geoError, setGeoError] = useState<string | null>(null);

  const requestLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setGeoStatus("unavailable");
      setGeoError("Geolocation is not supported by this browser.");
      return;
    }

    setGeoStatus("requesting");
    setGeoError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const coordStr = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        setCoords(coordStr);
        setGeoStatus("granted");

        // Reverse geocode asynchronously — does not block the UI
        reverseGeocode(lat, lng)
          .then((addr) => setAddress(addr))
          .catch(() => {
            // Geocode failed — fall back to raw coords
            setAddress(coordStr);
          });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGeoStatus("denied");
          setGeoError("Location permission denied. Please allow location access.");
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setGeoStatus("unavailable");
          setGeoError("Location unavailable. Please enter your address manually.");
        } else {
          setGeoStatus("error");
          setGeoError(`Location error: ${err.message}`);
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  // Request location automatically on mount
  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  return { callerId, coords, address, geoStatus, geoError, requestLocation };
}
