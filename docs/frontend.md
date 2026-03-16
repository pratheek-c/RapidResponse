# Frontend Guide

The frontend is a React 18 + TypeScript + Vite SPA in `frontend/`.

---

## Table of Contents

- [Setup](#setup)
- [Project Structure](#project-structure)
- [Routing](#routing)
- [Authentication](#authentication)
- [Hooks](#hooks)
- [Key Components](#key-components)
- [Type Model](#type-model)
- [Vite Proxy](#vite-proxy)

---

## Setup

From repo root:

```bash
bun run dev:frontend
```

Backend must be running too:

```bash
bun run dev:backend
```

Vite dev proxy behavior:

| Prefix | Target |
|---|---|
| `/api/*` | `http://localhost:3000` |
| `/events` | `http://localhost:3000/events` |
| `/ws/*` | `ws://localhost:3000` |

---

## Project Structure

```
frontend/src/
├── App.tsx
├── main.tsx
├── config/
│   ├── constants.ts
│   ├── firebase.ts        # Firebase app + auth + Google provider
│   └── mapStyles.ts
├── context/
│   └── SessionContext.tsx # Role-based session state (role, unit, station)
├── types/
│   ├── index.ts
│   └── dashboard.ts       # Department, IncidentStatus, SSE event types, etc.
├── hooks/
│   ├── useAuth.ts         # Firebase auth state, sign-in/out
│   ├── useCallerInfo.ts
│   ├── useCallSocket.ts
│   ├── useDispatcherLocation.ts
│   ├── useIncidents.ts
│   ├── useSSE.ts          # Dedicated SSE hook (annotation accumulation)
│   └── useUnits.ts
├── components/
│   ├── common/
│   │   ├── AssignmentAlertBanner.tsx  # Unit officer assignment/auto-dispatch alerts
│   │   ├── BackupAlertBanner.tsx      # Unit officer backup request alerts
│   │   ├── DeptIcon.tsx       # Icon per Department (patrol/fire/medical/hazmat)
│   │   ├── Header.tsx         # Dashboard top bar with live indicator + sign-out
│   │   ├── LiveIndicator.tsx
│   │   ├── SeverityBadge.tsx
│   │   ├── StatusBadge.tsx
│   │   └── TimeAgo.tsx
│   ├── dispatch/
│   │   ├── ActionButtons.tsx
│   │   ├── BackupModal.tsx    # Modal for unit officers to request backup
│   │   ├── QAThread.tsx
│   │   ├── QuestionInput.tsx
│   │   ├── SummaryModal.tsx
│   │   └── UnitSelector.tsx
│   ├── incidents/
│   │   ├── IncidentCard.tsx
│   │   ├── IncidentDetail.tsx
│   │   └── IncidentList.tsx
│   ├── map/
│   │   ├── CommandMap.tsx
│   │   ├── DispatcherMarker.tsx
│   │   ├── IncidentMarker.tsx
│   │   ├── MapLegend.tsx
│   │   ├── RoutePolyline.tsx
│   │   └── UnitMarker.tsx
│   └── transcript/
│       └── LiveTranscript.tsx  # Unified transcript + annotation pill timeline
└── pages/
    ├── CallerView.tsx
    ├── DashboardView.tsx       # Active dispatcher/unit-officer dashboard
    ├── DispatcherDashboard.tsx # Legacy dispatcher dashboard (kept for compatibility)
    └── LoginPage.tsx           # Two-step auth: Google sign-in → role selector
```

---

## Routing

| Path | Component | Notes |
|---|---|---|
| `/` | `CallerView` | Public caller UI; starts call on "Call 911" button click |
| `/login` | `LoginPage` | Dispatcher auth; redirects to `/dashboard` after sign-in |
| `/dashboard` | `DashboardView` | Protected dispatcher dashboard; redirects to `/login` if not authenticated |
| `*` | Redirect | Fallback to `/` |

---

## Authentication

Authentication uses a two-step flow: Google SSO → role selection.

**Config:** `frontend/src/config/firebase.ts`
- Reads `VITE_FIREBASE_*` env vars at build time
- If any var is missing, `hasFirebaseConfig` is `false` and sign-in is disabled
- Falls back to safe demo values so the app can still render

**Hook:** `frontend/src/hooks/useAuth.ts`
- `isAuthenticated` — `true` when Firebase reports a signed-in user
- `signInWithGoogle()` — opens Google sign-in popup
- `signInDev()` — available in DEV mode to skip Firebase auth
- `signOut()` — signs out from Firebase
- `hasFirebaseConfig` — forwarded from firebase config

**Session context:** `frontend/src/context/SessionContext.tsx`
- `session` — persisted to `localStorage` under `rr_session`
- Shape: `{ user: { id, name, email, avatar }, role: "dispatcher"|"unit_officer", unit?: { id, type, label }, station?: { id, name } }`
- `setSession(session)` — stores session and updates state
- `clearSession()` — removes session on sign-out

**Login page flow (`frontend/src/pages/LoginPage.tsx`):**

Step 1 — Sign in:
1. If already authenticated with a stored session, immediately redirects to `/dashboard`
2. "Continue with Google" button triggers `signInWithGoogle()`
3. In DEV mode a "Skip sign-in" button calls `signInDev()` to bypass Firebase

Step 2 — Role selector (rendered after successful auth, before dashboard entry):
1. User picks role: **DISPATCHER** (Command Center) or **UNIT OFFICER** (Field Responder)
2. If **Dispatcher**: selects a station from the dropdown (Dublin Central, Cork Central, Galway Central)
3. If **Unit Officer**: picks their department tab (Garda/DFB/NAS/Hazmat), then selects an available unit from the live `GET /units?status=available` list
4. "Enter Dashboard" is enabled once a valid selection is made; clicking it stores the session and navigates to `/dashboard`

**Required env vars for auth:**

| Variable | Example |
|---|---|
| `VITE_FIREBASE_API_KEY` | `AIzaSy...` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `your-project.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | `your-project-id` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `your-project.appspot.com` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `1234567890` |
| `VITE_FIREBASE_APP_ID` | `1:123:web:abc` |

---

## Hooks

### `useSSE`

**File:** `frontend/src/hooks/useSSE.ts`

Dedicated SSE hook that owns the `EventSource` connection. Separates SSE plumbing from incident business logic.

Returns:

```ts
{
  connected: boolean;
  lastEvent: SseEnvelope | null;
  getAnnotations: (incident_id: string) => TranscriptAnnotation[];
}
```

`SseEnvelope` shape: `{ type: DashboardEventType; data: unknown }`

`TranscriptAnnotation` shape: `{ icon: string; label: string; color: string; timestamp: string }`

Handled event types:

| Event | Behavior |
|---|---|
| `transcript_annotation` | Accumulates annotation pills keyed by `incident_id` in local state; does NOT set `lastEvent` |
| All other events | Sets `lastEvent`; consumers filter by type |

### `useDispatcherLocation`

**File:** `frontend/src/hooks/useDispatcherLocation.ts`

Returns live `LatLng | null` from `navigator.geolocation.watchPosition`. Used by `CommandMap` to render the dispatcher's position marker.

### `useCallSocket`

Manages caller-side WebSocket and audio pipeline.

Current capture/playback behavior:
- capture uses `ScriptProcessorNode` and sends raw PCM16 16kHz mono
- playback uses `AudioContext` resume guard and queued 24kHz PCM output
- includes `stopCapture()` cleanup path

Returns include call status, transcript, report, approaching unit, and start/end controls.

### `useIncidents`

Combines initial REST load with continuous SSE updates. Uses `useSSE` internally.

Current return shape:

```ts
{
  incidents,
  connected,
  extractions,
  escalations,
  refetch
}
```

Where:
- `incidents: Incident[]`
- `connected: boolean`
- `extractions: Record<string, ExtractionData>` (keyed by `incident_id`)
- `escalations: Record<string, EscalationSuggestion>` (keyed by `incident_id`)
- `refetch: () => Promise<void>`

Handled SSE events:

| Event | Behavior |
|---|---|
| `incident_created` | prepends new incident |
| `incident_updated` | upserts incident |
| `incident_classified` | upserts classified incident payload |
| `status_change` | updates incident status or upserts included incident |
| `incident_completed` | sets `status=completed` and updates summary |
| `extraction_update` | updates `extractions[incident_id]` |
| `escalation_suggestion` | updates `escalations[incident_id]` |

### `useUnits`

Fetches units and refreshes periodically for panel state consistency.

---

## Key Components

### `LiveTranscript.tsx`

**File:** `frontend/src/components/transcript/LiveTranscript.tsx`

Renders a unified, chronologically-sorted timeline of transcript lines and annotation pills.

Props:

```ts
{
  lines: TranscriptLine[];
  annotations?: TranscriptAnnotation[];
}
```

- `TranscriptLine` — `{ id, role: "caller"|"ai", text, timestamp }`
- `TranscriptAnnotation` — `{ icon, label, color, timestamp }`

Color classes supported: `blue`, `green`, `yellow`, `cyan`, `red`. Falls back to a slate default.

Auto-scrolls to the bottom on each new item.

### `AssignmentAlertBanner.tsx`

**File:** `frontend/src/components/common/AssignmentAlertBanner.tsx`

Shown in `DashboardView` for **unit officers** only. Listens via `useSSE` for:
- `assignment_suggested` — shows amber "ASSIGNMENT ALERT" banner; unit officer can click **Accept Assignment** which calls `POST /dispatch/take`
- `unit_auto_dispatched` — shows red "EMERGENCY AUTO-DISPATCH" banner with a "View Incident" link

Only shows alerts targeted at the current session's unit (`session.unit.id`). Alerts can be dismissed individually.

### `BackupAlertBanner.tsx`

**File:** `frontend/src/components/common/BackupAlertBanner.tsx`

Shown in `DashboardView` for **unit officers** only. Listens for `backup_requested` SSE events. Does not show the alert to the unit that requested backup. Renders urgency-colored banners (`emergency`/`urgent`/`routine`) with an **I'll Respond** button that calls `POST /dispatch/backup-respond`.

### `BackupModal.tsx`

**File:** `frontend/src/components/dispatch/BackupModal.tsx`

Modal dialog for unit officers to request backup on their current incident. Allows selecting unit type(s), urgency level, and an optional message. On submit, calls `POST /dispatch/backup-request`.

### `Badges.tsx`

`StatusBadge` now supports all 8 incident states:
- `active`
- `classified`
- `dispatched`
- `en_route`
- `on_scene`
- `completed`
- `resolved`
- `cancelled`

The visual system remains monochrome/greyscale.

### `IncidentList.tsx`

Filter tabs are now:
- `All`
- `Active`
- `Dispatched`
- `On Scene`
- `Resolved`

### `IncidentDetail.tsx`

`IncidentDetail` is now a full dispatcher action workspace.

Current props:

```ts
{
  incident: Incident;
  units: Unit[];
  onDispatch: (incidentId: string, unitIds: string[], officerId: string) => Promise<void>;
  extraction: ExtractionData | null;
  escalation: EscalationSuggestion | null;
}
```

Tabs:
- `AI Report`
- `Transcript`
- `Actions`

Primary capabilities:
- live extraction panel from `extraction` prop
- escalation suggestion banner with one-click escalate action
- multi-select accept flow with optional officer ID
- ask-via-AI question panel showing question/answer history
- complete incident flow
- save report summary flow
- assigned units panel from `incident_units`
- dispatch action audit timeline in Actions tab

Fetches on incident change:
- `GET /incidents/:id/transcript`
- `GET /dispatch/:incident_id` (legacy fallback)
- `GET /incidents/:id/actions`
- `GET /incidents/:id/questions`
- `GET /incidents/:id/units`
- `GET /report/:incident_id`

Writes from UI:
- `POST /dispatch/accept`
- `POST /dispatch/question`
- `POST /dispatch/escalate`
- `POST /dispatch/complete`
- `POST /dispatch/save-report`

### `DashboardView.tsx`

**File:** `frontend/src/pages/DashboardView.tsx`

Active dispatcher/unit-officer dashboard. Integrates:
- `useIncidents` + `useUnits` for live data
- `useSSE` (via `AssignmentAlertBanner` and `BackupAlertBanner`)
- `useDispatcherLocation` for map marker
- `AssignmentAlertBanner` and `BackupAlertBanner` rendered at the top of the view
- Role-aware rendering via `useSession` — unit officers see their unit's incidents; dispatchers see all
- Passes `extraction` and `escalation` into `IncidentDetail`
- Stats bar reflects all lifecycle statuses

---

## Type Model

`frontend/src/types/index.ts` mirrors backend shared types manually.

Major additions:
- expanded `IncidentStatus` (8 values)
- dispatch extension fields on `Incident` (`cad_number`, `covert_distress`)
- extended `SseEventType` set
- `Department`
- `DispatchAction`
- `IncidentUnit`
- `DispatchQuestion`
- `ExtractionData`
- `EscalationSuggestion`
- `DashboardSsePayload`

`frontend/src/types/dashboard.ts` adds:
- `TranscriptLine` — `{ id, role: "caller"|"ai", text, timestamp }`
- `TranscriptAnnotation` — `{ icon, label, color, timestamp }`
- `DashboardIncident` — extended incident type for dashboard rendering
- `SessionData` — `{ user, role: "dispatcher"|"unit_officer", unit?, station? }`

`DashboardSsePayload` union includes all current SSE event payloads:
- `incident_created`, `incident_classified`, `transcript_update`, `extraction_update`
- `answer_update`, `unit_dispatched`, `status_change`, `escalation_suggestion`
- `incident_completed`, `transcript_annotation`, `assignment_suggested`
- `unit_auto_dispatched`, `backup_requested`, `backup_accepted`
- `covert_distress`, `unit_status_change`

---

## Vite Proxy

`vite.config.ts` proxies API, SSE, and WS to backend during development.

When deploying, set:
- `VITE_API_BASE` to HTTPS API URL
- `VITE_WS_BASE` to WSS API URL

---

## Build

```bash
bun run build:frontend
```

Output: `frontend/dist/`
