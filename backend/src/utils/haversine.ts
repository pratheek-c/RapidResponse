/**
 * Haversine distance calculation.
 * Returns the great-circle distance between two points in kilometres.
 */

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * haversine(lat1, lng1, lat2, lng2) → distance in km
 */
export function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/**
 * Estimate ETA in minutes given distance_km and an average speed in km/h.
 * Default speed is 60 km/h (emergency vehicle urban).
 */
export function etaMinutes(distanceKm: number, speedKmh = 60): number {
  return Math.ceil((distanceKm / speedKmh) * 60);
}
