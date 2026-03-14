# Frontend Guide

The frontend is a React 18 + TypeScript + Vite single-page application served from `frontend/`.

---

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Environment Variables](#environment-variables)
- [Pages](#pages)
  - [DispatcherDashboard (`/dashboard`)](#dispatcherdashboard-dashboard)
  - [CallerView (`/call`)](#callerview-call)
- [Hooks](#hooks)
  - [useIncidents](#useincidents)
  - [useUnits](#useunits)
  - [useCallSocket](#usecallsocket)
- [Components](#components)
  - [Badges](#badges)
  - [IncidentList](#incidentlist)
  - [IncidentDetail](#incidentdetail)
  - [UnitPanel](#unitpanel)
- [Types](#types)
- [Routing](#routing)
- [API Proxy (Vite)](#api-proxy-vite)
- [Building for Production](#building-for-production)

---

## Development Setup

```bash
# From the repo root
bun run dev:frontend
```

The Vite dev server starts at `http://localhost:5173`.

The backend must also be running for any data to load:

```bash
bun run dev:backend   # http://localhost:3000
```

In development, Vite proxies API and WebSocket requests so you never need to deal with CORS:

| Path prefix | Proxied to |
|---|---|
| `/api/*` | `http://localhost:3000` (strips `/api`) |
| `/events` | `http://localhost:3000/events` |
| `/ws/*` | `ws://localhost:3000` (WebSocket, strips `/ws`) |

---

## Project Structure

```
frontend/src/
├── main.tsx              # React root, createRoot()
├── App.tsx               # BrowserRouter + route definitions
├── vite-env.d.ts         # TypeScript declarations for import.meta.env
├── types/
│   └── index.ts          # All shared types (mirror of backend/src/types/index.ts)
├── hooks/
│   ├── useIncidents.ts   # SSE + REST for live incident list
│   ├── useUnits.ts       # REST poll for unit list
│   └── useCallSocket.ts  # WebSocket + mic audio + Nova Sonic audio playback
├── components/
│   ├── Badges.tsx        # PriorityBadge, StatusBadge, TypeChip
│   ├── IncidentList.tsx  # Sidebar list of incidents
│   ├── IncidentDetail.tsx# Main panel: detail, dispatch, transcript
│   └── UnitPanel.tsx     # Right sidebar: unit grid by type
└── pages/
    ├── DispatcherDashboard.tsx
    └── CallerView.tsx
```

---

## Environment Variables

Create `frontend/.env` (or add to the root `.env`) to configure the frontend. All variables are prefixed with `VITE_` and are exposed to the browser bundle.

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE` | `""` (empty — uses Vite proxy) | Base URL for REST API calls. Set to `http://localhost:3000` if not using the Vite proxy |
| `VITE_WS_BASE` | `ws://<window.location.host>` | WebSocket base URL. Set to `ws://localhost:3000` if needed |

In production, set `VITE_API_BASE=https://api.yourapp.com` and `VITE_WS_BASE=wss://api.yourapp.com` at build time.

---

## Pages

### DispatcherDashboard (`/dashboard`)

`frontend/src/pages/DispatcherDashboard.tsx`

The main operator interface. Three-column layout:

```
┌──────────────────┬──────────────────────────────┬────────────────┐
│  INCIDENTS       │  Incident Detail              │  UNITS         │
│  (sidebar)       │  (main content)               │  (sidebar)     │
│                  │                               │                │
│  Live list from  │  Selected incident info:      │  Unit grid     │
│  SSE /events     │  • status / priority / type   │  grouped by    │
│                  │  • location / caller ID        │  unit type     │
│  Click to select │  • summary                    │  with status   │
│                  │  • dispatch panel             │  color coding  │
│                  │  • dispatched units list       │                │
│                  │  • transcript                 │                │
└──────────────────┴──────────────────────────────┴────────────────┘
```

**Header bar:**
- "RapidResponse.ai" branding with live SSE connection status dot
- "Simulate 911 Call" button links to `/call`

**Incident list sidebar:**
- Powered by `useIncidents()` hook
- Auto-updates in real time via SSE
- Shows incident ID, location, priority badge, status badge, type chip, time
- Click any incident to load its detail in the main panel

**Incident detail panel:**
- Shows all incident metadata
- If `status === "active"`: dispatch panel with unit selector dropdown (filtered to available units)
- Shows all dispatch records with arrival times
- Shows full transcript with caller/agent bubbles

**Unit panel sidebar:**
- Powered by `useUnits()` hook (10-second poll)
- Units grouped by type (ems, fire, police, hazmat, rescue)
- Color-coded border by status:
  - Green border: `available`
  - Orange border: `dispatched`
  - Blue border: `on_scene`
  - Purple border: `returning`
- Hover shows tooltip with full status and incident assignment

---

### CallerView (`/call`)

`frontend/src/pages/CallerView.tsx`

A call simulation interface. Intended for testing the AI voice agent without a real phone system.

**Before call:**
- Caller ID input (defaults to `CALLER-ANON`)
- Location input (defaults to `Unknown location`)
- "Call 911" button

**During call:**
- Pulsing green "CALL IN PROGRESS" indicator with incident ID
- Real-time transcript bubbles (caller on left, AI agent on right)
- Classification banner when Nova Sonic classifies the incident
- "Hang Up" button to end the call cleanly

**After call:**
- "Call ended." status
- Full transcript remains visible
- Form resets to allow simulating another call

**Audio flow:**
1. `getUserMedia({ audio: true })` — requests mic permission
2. `MediaRecorder` captures audio as `audio/webm;codecs=opus` in 32ms chunks
3. Each chunk is read as an `ArrayBuffer`, base64-encoded, and sent as `audio_chunk` over WebSocket
4. Incoming `audio_response` messages are decoded from base64 PCM and enqueued for sequential playback via `AudioContext` (24kHz sample rate)

---

## Hooks

### `useIncidents`

`frontend/src/hooks/useIncidents.ts`

Manages the live incident list by combining an initial REST fetch with ongoing SSE updates.

```typescript
const { incidents, connected, refetch } = useIncidents();
```

| Return value | Type | Description |
|---|---|---|
| `incidents` | `Incident[]` | Current incident list, most recent first |
| `connected` | `boolean` | Whether the SSE stream is open |
| `refetch` | `() => Promise<void>` | Manually re-fetch all incidents from `GET /incidents` |

**Behavior:**
- On mount: fetches `GET /incidents` to seed the initial list
- Opens `EventSource` to `GET /events`
- On `incident_created`: prepends the new incident to the list
- On `incident_updated` / `incident_classified`: finds the incident by ID and replaces it in place
- On unmount: closes the `EventSource`

---

### `useUnits`

`frontend/src/hooks/useUnits.ts`

Fetches and caches the unit list with periodic refresh.

```typescript
const { units, loading, refetch } = useUnits();
```

| Return value | Type | Description |
|---|---|---|
| `units` | `Unit[]` | All units |
| `loading` | `boolean` | True on first load |
| `refetch` | `() => Promise<void>` | Manually re-fetch units |

**Behavior:**
- Fetches `GET /units` on mount
- Automatically re-fetches every 10 seconds
- `refetch` is called after a successful manual dispatch to immediately reflect the unit's new `dispatched` status

---

### `useCallSocket`

`frontend/src/hooks/useCallSocket.ts`

Manages the full call lifecycle: microphone capture, WebSocket connection, Nova Sonic audio playback, and transcript accumulation.

```typescript
const {
  status,
  incidentId,
  transcript,
  classification,
  errorMessage,
  startCall,
  endCall,
  flushAudioQueue,
} = useCallSocket();
```

**State**

| Value | Type | Description |
|---|---|---|
| `status` | `CallStatus` | `"idle"`, `"connecting"`, `"active"`, `"ended"`, `"error"` |
| `incidentId` | `string \| null` | Incident UUID from `call_accepted` message |
| `transcript` | `TranscriptLine[]` | Accumulated `{ role, text }` turns |
| `classification` | `ClassificationResult \| null` | `{ incident_type, priority }` from `incident_classified` message |
| `errorMessage` | `string \| null` | Latest error message |

**Methods**

| Method | Description |
|---|---|
| `startCall(callerId, location)` | Request mic → open WebSocket → send `call_start` |
| `endCall()` | Send `call_end` → stop recording → close WebSocket |
| `flushAudioQueue()` | Discard buffered audio (called on barge-in) |

**Audio playback details:**

Incoming PCM (24kHz) is decoded and queued for sequential playback:

```
base64 string
  → atob()
  → Uint8Array
  → DataView.getInt16() / 32768  (PCM16 → float32)
  → AudioBuffer (24kHz, 1 channel)
  → AudioContext.createBufferSource().start()
```

A simple queue ensures audio chunks play in order without gaps. On `__FLUSH__` (barge-in), `flushAudioQueue()` discards all pending buffers and resets the `playing` flag.

---

## Components

### Badges

`frontend/src/components/Badges.tsx`

Three display-only badge components used throughout the dashboard.

**`PriorityBadge`**
```tsx
<PriorityBadge priority="P1" />
```
Renders a colored pill: P1=red, P2=orange, P3=yellow, P4=gray.

**`StatusBadge`**
```tsx
<StatusBadge status="active" />
```
Renders a colored pill: active=green, dispatched=blue, resolved=gray, cancelled=dark gray.

**`TypeChip`**
```tsx
<TypeChip type="fire" />
```
Renders an emoji + label: fire🔥, medical🚑, police👮, traffic🚗, hazmat☣️, search_rescue🔍, other📋.

---

### IncidentList

`frontend/src/components/IncidentList.tsx`

Renders the sidebar list of incidents. Highlights the selected incident.

```tsx
<IncidentList
  incidents={incidents}
  onSelect={(id) => setSelectedId(id)}
  selectedId={selectedId}
/>
```

| Prop | Type | Description |
|---|---|---|
| `incidents` | `Incident[]` | List to render |
| `onSelect` | `(id: string) => void` | Called when an incident row is clicked |
| `selectedId` | `string \| null` | ID of currently selected incident (highlighted) |

Each row shows: short incident ID, priority badge, status badge, location, type chip, creation time.

---

### IncidentDetail

`frontend/src/components/IncidentDetail.tsx`

The main content panel. Fetches additional data for the selected incident and renders the full detail view.

```tsx
<IncidentDetail
  incident={selectedIncident}
  units={units}
  onDispatch={async (incidentId, unitId) => { ... }}
/>
```

| Prop | Type | Description |
|---|---|---|
| `incident` | `Incident` | The incident to display |
| `units` | `Unit[]` | All units (for dispatch selector) |
| `onDispatch` | `(incidentId: string, unitId: string) => Promise<void>` | Called when dispatcher submits a manual dispatch |

**Internal fetches:**
- `GET /incidents/:id/transcript` — loads transcription turns
- `GET /dispatch/:incident_id` — loads dispatch records

Both are re-fetched whenever `incident.id` changes.

**Dispatch panel** — only rendered when `incident.status === "active"`:
- Dropdown showing only `available` units with their code and type
- "Dispatch" button — disabled until a unit is selected
- Calls `onDispatch(incident.id, selectedUnit)` on submit

---

### UnitPanel

`frontend/src/components/UnitPanel.tsx`

The right sidebar showing all units grouped by type.

```tsx
<UnitPanel units={units} />
```

Units are displayed as compact chips with:
- Colored dot indicating status
- Colored border matching status (green/orange/blue/purple)
- `unit_code` label
- Tooltip showing full status and incident ID if assigned

Status color mapping:
| Status | Color |
|---|---|
| `available` | Green `#22c55e` |
| `dispatched` | Orange `#f97316` |
| `on_scene` | Blue `#3b82f6` |
| `returning` | Purple `#a78bfa` |

---

## Types

`frontend/src/types/index.ts` is a manual mirror of `backend/src/types/index.ts`. It contains all shared TypeScript types used across the frontend:

- `Incident`, `IncidentStatus`, `IncidentType`, `IncidentPriority`
- `TranscriptionTurn`, `TranscriptionRole`
- `Unit`, `UnitType`, `UnitStatus`
- `Dispatch`
- `SseEvent`, `SseEventType`
- `WsClientMessage` and all subtypes (`WsCallStartMessage`, `WsAudioChunkMessage`, `WsCallEndMessage`)
- `WsServerMessage` and all subtypes
- `ApiSuccess<T>`, `ApiError`, `ApiResponse<T>`

> **Note:** These types are kept in sync manually. If you add a new field to the backend types, update the frontend types file as well.

---

## Routing

Routes are defined in `App.tsx`:

| Path | Component | Description |
|---|---|---|
| `/` | Redirect to `/dashboard` | — |
| `/dashboard` | `DispatcherDashboard` | Operator dispatch interface |
| `/call` | `CallerView` | 911 call simulator |
| `*` | Redirect to `/dashboard` | 404 fallback |

---

## API Proxy (Vite)

`vite.config.ts` defines the development proxy so the frontend can call backend endpoints without CORS issues:

```typescript
server: {
  proxy: {
    "/api": {
      target: "http://localhost:3000",
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ""),
    },
    "/events": {
      target: "http://localhost:3000",
      changeOrigin: true,
    },
    "/ws": {
      target: "ws://localhost:3000",
      ws: true,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/ws/, ""),
    },
  },
},
```

The hooks and pages use `VITE_API_BASE` (defaults to `""`) as their base URL, so in development all requests go through the proxy transparently.

---

## Building for Production

```bash
bun run build:frontend
```

Output goes to `frontend/dist/`. Deploy as a static site and configure your reverse proxy or CDN to point API requests at the backend server.

**Example nginx config snippet:**

```nginx
location /api/ {
  proxy_pass http://backend:3000/;
}

location /events {
  proxy_pass http://backend:3000/events;
  proxy_set_header Connection '';
  proxy_http_version 1.1;
  chunked_transfer_encoding on;
}

location /call {
  proxy_pass http://backend:3000/call;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}

location / {
  root /var/www/rapidresponse/dist;
  try_files $uri $uri/ /index.html;
}
```
