---
name: project_codebase_map
description: File locations, component hierarchy, routing, state management, and styling conventions for RapidResponse.ai frontend
type: project
---

## Routing (App.tsx)
- `/` → CallerView (caller/patient side — simulates 112 call)
- `/login` → LoginPage (Google SSO + department selection)
- `/dashboard` → DashboardView (primary dispatcher interface)
- `/dispatcher` → DispatcherDashboard (alternative white/black theme dashboard — used by actual dispatchers)

**Why:** Two dashboard views exist. DashboardView uses Tailwind dark theme + map. DispatcherDashboard uses inline styles white/black monochrome. The DispatcherDashboard imports from components/IncidentDetail.tsx and components/IncidentList.tsx (NOT components/incidents/). The DashboardView imports from components/incidents/.

## Component Hierarchy
- `pages/DashboardView.tsx` — main authenticated dispatcher view
  - `components/common/Header.tsx` — nav bar with live indicator, dept badge, sign out
  - `components/map/CommandMap.tsx` — Leaflet/Mapbox map (primary spatial view)
  - `components/incidents/IncidentList.tsx` — left sidebar list with search + filter
    - `components/incidents/IncidentCard.tsx` — individual incident card
  - `components/incidents/IncidentDetail.tsx` — right panel when incident selected
    - `components/dispatch/ActionButtons.tsx` — Accept/Escalate/Complete buttons
    - `components/dispatch/QuestionInput.tsx` — "Ask caller follow-up" input
    - `components/dispatch/QAThread.tsx` — Q&A history display
    - `components/dispatch/UnitSelector.tsx` — unit selection grid
    - `components/dispatch/SummaryModal.tsx` — post-completion summary modal
    - `components/transcript/LiveTranscript.tsx` — live transcript display
  - `components/map/MapLegend.tsx` — bottom legend

- `pages/DispatcherDashboard.tsx` — alternative dispatcher view (white/black monochrome)
  - Uses inline styles only (no Tailwind)
  - Imports `components/IncidentDetail.tsx` and `components/IncidentList.tsx` (legacy)
  - Has its own StatsTile, DispatcherCard, ZoneChip, EmptyState sub-components

## State Management
- No Redux/Zustand — pure React state + custom hooks
- `hooks/useIncidents.ts` — fetches /incidents, listens to SSE, merges extraction/escalation data
- `hooks/useUnits.ts` — fetches /units
- `hooks/useSSE.ts` — wraps EventSource for server-sent events
- `hooks/useAuth.ts` — Firebase Google SSO + dev bypass
- `hooks/useCallerInfo.ts` — geolocation + caller metadata
- `hooks/useCallSocket.ts` — WebSocket for live call audio streaming

## Styling Conventions
- Primary framework: Tailwind CSS with custom tokens in tailwind.config
- CSS variables: `bg-command-bg`, `bg-command-panel`, `bg-command-card`, `text-command-text`
- Dark theme: bg is `#0a0f1e`, body gradient from `#172554` to `#0a0f1e`
- Font: "Manrope" (primary), fallback "Segoe UI"
- DispatcherDashboard uses only inline styles (white/black: #000, #fff, #f5f5f5, #e5e5e5)
- Colored status dots kept intentionally: green=#16a34a, orange=#f97316, blue=#3b82f6, purple=#a78bfa
- Priority badges: P1=red, P2=orange, P3=yellow, P4=gray

## Types
- `types/dashboard.ts` — DashboardIncident, DashboardUnit, QAEntry, all SSE event types
- `types/index.ts` — raw DB types (Incident, Unit, TranscriptionTurn, etc.)
- Dashboard uses DashboardIncident (enriched with severity/urgency/location/injuries/hazards)
- IncidentStatus: active, classified, dispatched, en_route, on_scene, completed, resolved, cancelled

## Config
- `config/constants.ts` — API_BASE from VITE_API_BASE env
- `config/firebase.ts` — Firebase config: initialises app only when all VITE_FIREBASE_* vars are present; exposes `firebaseApp`, `firebaseAuth`, `googleProvider`, `hasFirebaseConfig`
- `config/mapStyles.ts` — map styling config

## Auth (useAuth.ts + LoginPage.tsx)
- Firebase Google SSO via `signInWithPopup`; guarded by `hasFirebaseConfig`
- Dev bypass: `signInDev()` sets localStorage key `rr_dev_bypass=1` → `isAuthenticated` becomes true → Navigate fires
- `loading` state: true until `onAuthStateChanged` first fires (or firebase is absent); LoginPage renders a Loader2 spinner while `loading === true` to prevent flash-of-login for already-authenticated users
- Frontend `.env` has all 6 VITE_FIREBASE_* vars set without leading spaces (unlike the backend .env which has spurious leading spaces — backend .env is NOT read by Vite, frontend .env is)

## Dublin Unit Type Label Map (canonical)
All components must use these display labels for unit type strings:
- `fire`    → "DFB"   (Dublin Fire Brigade)
- `ems`     → "NAS"   (National Ambulance Service)
- `police`  → "GARDA" (An Garda Síochána)
- `hazmat`  → "HAZMAT"
- `rescue`  → "SAR"   (Search & Rescue)
- Incident type `traffic` → "RTC" (Road Traffic Collision, Irish convention)
- Incident type `medical` → "NAS"
- Files containing these label maps: UnitSelector.tsx, UnitPanel.tsx, Badges.tsx, IncidentCard.tsx
