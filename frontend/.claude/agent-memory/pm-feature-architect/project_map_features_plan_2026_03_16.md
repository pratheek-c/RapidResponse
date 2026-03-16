---
name: Map Feature Plan — Dispatcher Location + Filtered Markers
description: Architecture notes and implementation plan for dispatcher live GPS marker + route line, and filter-synced map markers. Planned March 2026.
type: project
---

# Map Feature Plan (2026-03-16)

## Feature 1: Dispatcher live location + route to selected incident

**Key architectural facts:**
- CommandMap uses react-leaflet's MapContainer. All child components must use react-leaflet hooks (useMap).
- No routing library is currently installed. Two options: OSRM (free, no key) or ArcGIS Routing (VITE_ARCGIS_API_KEY already in env via esri-leaflet-vector).
- Decision: Use OSRM (`router.project-osrm.org/route/v1/driving`) — free, no key, returns GeoJSON-compatible geometry. ArcGIS routing adds cost at scale and requires a separate @arcgis/core import. OSRM is standard for dispatching contexts.
- Route rendering: use react-leaflet `Polyline` component with the decoded route geometry. No extra npm package needed — leaflet-routing-machine is heavyweight and opinionated.
- Dispatcher marker: a new `DispatcherMarker` component, styled distinctly (star or crosshair DivIcon, white/blue color, pulsing ring).
- Location source: `navigator.geolocation.watchPosition` — wrap in a custom hook `useDispatcherLocation` in `src/hooks/`.
- ETA/distance: OSRM response includes `duration` (seconds) and `distance` (meters) in `routes[0]`. Display as overlay badge on the map.

## Feature 2: Filter-synced map markers

**Key architectural facts:**
- `filter` state is currently local to `IncidentList` (line 17 of IncidentList.tsx).
- `CommandMap` receives the full `incidents` array from `DashboardView` (line 327-333 of DashboardView.tsx) and renders ALL of them.
- The fix: lift `filter` state from `IncidentList` up to `DashboardView`, pass it down as a prop to `IncidentList`, and use it to pre-filter the incidents array passed to `CommandMap`.
- `query` (search text) should NOT be lifted — map should not respond to sidebar search text, only the tab filter.
- The filter-to-status mapping logic currently duplicated in `IncidentList` (lines 41-50) must be extracted to a shared utility.

**Why:** Keeping query local prevents map from hiding incident dots just because dispatcher is typing in search box.

## Files affected summary

| File | Change |
|------|--------|
| `src/hooks/useDispatcherLocation.ts` | NEW — watchPosition hook, returns `{lat, lng} | null` |
| `src/components/map/DispatcherMarker.tsx` | NEW — DivIcon marker for dispatcher position |
| `src/components/map/RoutePolyline.tsx` | NEW — fetches OSRM route, renders Polyline + ETA badge |
| `src/components/map/CommandMap.tsx` | Add dispatcherLocation prop, render DispatcherMarker + RoutePolyline |
| `src/pages/DashboardView.tsx` | Add filter state, pass to IncidentList; filter incidents before passing to CommandMap |
| `src/components/incidents/IncidentList.tsx` | Accept filter+setFilter as props instead of local state |
| `src/utils/incidentFilters.ts` | NEW — shared filterIncidentsByTab utility function |
