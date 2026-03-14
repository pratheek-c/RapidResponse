# Frontend Guide

The frontend is a React 18 + TypeScript + Vite single-page application served from `frontend/`.

---

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Environment Variables](#environment-variables)
- [Routing](#routing)
- [Pages](#pages)
  - [CallerView (`/`)](#callerview-)
  - [DispatcherDashboard (`/dashboard`)](#dispatcherdashboard-dashboard)
- [Hooks](#hooks)
  - [useCallerInfo](#usecallerinfo)
  - [useCallSocket](#usecallsocket)
  - [useIncidents](#useincidents)
  - [useUnits](#useunits)
- [Components](#components)
  - [Badges](#badges)
  - [IncidentList](#incidentlist)
  - [IncidentDetail](#incidentdetail)
  - [UnitPanel](#unitpanel)
- [Types](#types)
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
│   ├── useCallerInfo.ts  # GPS location, reverse geocode, persistent caller UUID
│   ├── useIncidents.ts   # SSE + REST for live incident list
│   ├── useUnits.ts       # REST poll for unit list
│   └── useCallSocket.ts  # WebSocket + mic audio + Nova Sonic audio playback
├── components/
│   ├── Badges.tsx        # PriorityBadge, StatusBadge, TypeChip
│   ├── IncidentList.tsx  # Sidebar list of incidents with search + filter tabs
│   ├── IncidentDetail.tsx# Main panel: AI Report tab + Transcript tab
│   └── UnitPanel.tsx     # Right sidebar: unit cards with distance + ETA
└── pages/
    ├── CallerView.tsx
    └── DispatcherDashboard.tsx
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

## Routing

Routes are defined in `App.tsx`:

| Path | Component | Description |
|---|---|---|
| `/` | `CallerView` | 911 caller interface (auto-arms on mount) |
| `/dashboard` | `DispatcherDashboard` | Operator dispatch interface |
| `*` | Redirect to `/` | 404 fallback |

> **Note:** There is no `/call` route. The caller interface lives at `/`.

---

## Pages

### CallerView (`/`)

`frontend/src/pages/CallerView.tsx`

The browser-based 911 caller interface. Designed for use by a caller (or for simulation). Dark theme (`#080a0f` background).

**Auto-arms on mount** — as soon as `useCallerInfo` resolves a `callerId`, `startCall()` is invoked automatically. There is no manual "Call 911" button shown before the call starts.

**Voice state machine:**

```
arming → ready → listening → agent_speaking → ended / error
```

**What the caller sees during a call:**
- Animated audio waveform indicating live voice activity
- Live transcript bubbles (caller on left, AI agent on right)
- `DispatcherCard` — shown when `report_update` is received with a `dispatcher_assigned`
- `HelpBanner` — shown when a report is available; displays ETA countdown from `units_dispatched[0]`
- `ApproachingAlert` — shown when a `dispatcher_approaching` WS message is received; large alert with unit code, ETA, and crew names
- Collapsible `ReportPanel` — full AI-generated incident report (summary, recommended actions, units, timeline)

**After call ends:**
- "Call 911 Again" button reloads the page to restart

**Audio flow:**
1. `getUserMedia({ audio: true })` — requests mic permission
2. `MediaRecorder` captures audio as `audio/webm;codecs=opus` in 32ms chunks
3. Each chunk is read as an `ArrayBuffer`, base64-encoded, and sent as `audio_chunk` over WebSocket
4. Incoming `audio_response` messages are decoded from base64 PCM and enqueued for sequential playback via `AudioContext` (24kHz sample rate)

---

### DispatcherDashboard (`/dashboard`)

`frontend/src/pages/DispatcherDashboard.tsx`

The operator interface. White/black monochrome theme throughout. CSS grid layout:

```
gridTemplateRows:    "48px 44px 1fr"
gridTemplateColumns: "280px 1fr 300px"
```

**Row 1 — Nav bar** (black `#000`):
- "RapidResponse.ai" branding
- "DISPATCHER" role label
- Zone chips fetched from `GET /mock/dispatchers` (e.g. ZONE-A, ZONE-B…)
- SSE connection status dot (green = connected)
- "Simulate 911 Call" link → navigates to `/`

**Row 2 — Stats bar** (4 metric tiles):
- Active incidents (black background)
- Dispatched incidents
- Resolved incidents
- Available units count

**Row 3 — Three-column layout:**

```
┌──────────────────┬──────────────────────────────┬────────────────┐
│  IncidentList    │  IncidentDetail / EmptyState  │  Dispatchers   │
│  (280px)         │  (flex-grow)                  │  + UnitPanel   │
│                  │                               │  (300px)       │
│  Search input    │  Tabbed: AI Report |           │                │
│  Filter tabs     │          Transcript            │  On-duty cards │
│  Incident rows   │                               │  Off-duty cards│
│                  │                               │  Unit cards    │
└──────────────────┴──────────────────────────────┴────────────────┘
```

- **Left column:** `IncidentList` — live incident feed via SSE
- **Center column:** `IncidentDetail` when an incident is selected; `EmptyState` otherwise
- **Right column:** Dispatcher cards (on-duty/off-duty from `GET /mock/dispatchers`) followed by `UnitPanel`

On mount, fetches `GET /mock/dispatchers` to populate zone chips and dispatcher cards.

---

## Hooks

### `useCallerInfo`

`frontend/src/hooks/useCallerInfo.ts`

Provides caller identity and GPS location data for `CallerView`. Called once on mount; does not require any arguments.

```typescript
const { callerId, coords, address, geoStatus, geoError, requestLocation } = useCallerInfo();
```

| Return value | Type | Description |
|---|---|---|
| `callerId` | `string` | Persistent UUID stored in `localStorage` under `rr_caller_id`. Generated once with `crypto.randomUUID()` and reused across page loads |
| `coords` | `{ lat: number; lng: number } \| null` | GPS coordinates from `navigator.geolocation` |
| `address` | `string` | Human-readable address from OpenStreetMap Nominatim reverse geocode (no API key required). Falls back to `"lat,lng"` string if reverse geocode fails |
| `geoStatus` | `GeoStatus` | `"idle"` \| `"requesting"` \| `"granted"` \| `"denied"` \| `"unavailable"` \| `"error"` |
| `geoError` | `string \| null` | Error message if geolocation failed |
| `requestLocation` | `() => void` | Manually trigger geolocation (e.g. if initially denied then re-granted) |

**Behavior:**
- On mount: requests GPS via `navigator.geolocation.getCurrentPosition()`
- When coords are available: calls OpenStreetMap Nominatim `reverse` API to get a human-readable address
- `callerId` is read from `localStorage` on mount; if absent, a new UUID is generated and stored

---

### `useCallSocket`

`frontend/src/hooks/useCallSocket.ts`

Manages the full call lifecycle: microphone capture, WebSocket connection, Nova Sonic audio playback, and all inbound WS message handling.

```typescript
const {
  status,
  incidentId,
  transcript,
  classification,
  errorMessage,
  report,
  approachingUnit,
  startCall,
  endCall,
  flushAudioQueue,
} = useCallSocket();
```

**State**

| Value | Type | Description |
|---|---|---|
| `status` | `CallStatus` | `"idle"` \| `"connecting"` \| `"active"` \| `"ended"` \| `"error"` |
| `incidentId` | `string \| null` | Incident UUID from `call_accepted` message |
| `transcript` | `TranscriptLine[]` | Accumulated `{ role, text }` turns |
| `classification` | `ClassificationResult \| null` | `{ incident_type, priority }` from `incident_classified` message |
| `errorMessage` | `string \| null` | Latest error message |
| `report` | `IncidentReport \| null` | Latest report from `report_update` message |
| `approachingUnit` | `{ unit_code: string; eta_minutes: number; crew: { name: string; role: string }[] } \| null` | Payload from `dispatcher_approaching` message |

**Methods**

| Method | Signature | Description |
|---|---|---|
| `startCall` | `(callerId: string, location: string, address: string) => Promise<void>` | Request mic → open WebSocket → send `call_start` |
| `endCall` | `() => void` | Send `call_end` → stop recording → close WebSocket |
| `flushAudioQueue` | `() => void` | Discard buffered audio (called on barge-in) |

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

A simple queue ensures audio chunks play in order without gaps. On `__FLUSH__` sentinel (barge-in), `flushAudioQueue()` discards all pending buffers and resets the `playing` flag.

---

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

## Components

### Badges

`frontend/src/components/Badges.tsx`

Three display-only badge components used throughout the dashboard. All use a white/black monochrome color scheme — no colored priority or status pills.

**`PriorityBadge`**
```tsx
<PriorityBadge priority="P1" />
```

| Priority | Style |
|---|---|
| `P1` | Solid black background, white text |
| `P2` | Dark grey `#333`, white text |
| `P3` | Medium grey `#666`, white text |
| `P4` | Light grey background, dark text |

**`StatusBadge`**
```tsx
<StatusBadge status="active" />
```

| Status | Style |
|---|---|
| `active` | Black background, white text |
| `dispatched` | Dark `#444`, white text |
| `resolved` | Light grey, dark text |
| `cancelled` | Light grey, dark text |

**`TypeChip`**
```tsx
<TypeChip type="fire" />
```

Text-only monochrome labels — no emojis. Displays the incident type abbreviation:

| Type | Label |
|---|---|
| `fire` | FIRE |
| `medical` | MED |
| `police` | PD |
| `traffic` | MVA |
| `hazmat` | HZM |
| `search_rescue` | SAR |
| `other` | OTH |

---

### IncidentList

`frontend/src/components/IncidentList.tsx`

Renders the left sidebar list of incidents. Highlights the selected incident.

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

**Features:**
- **Search input** — filters the visible list by incident ID, `caller_location`, `caller_address`, or `type` (case-insensitive substring match)
- **Filter tabs** — All / Active / Dispatched / Resolved
- Each row shows: short incident ID, `PriorityBadge`, `StatusBadge`, address (prefers `caller_address` over `caller_location`), `TypeChip`, creation time

---

### IncidentDetail

`frontend/src/components/IncidentDetail.tsx`

The main content panel. Fetches additional data for the selected incident and renders a tabbed detail view.

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

**Tabs:**

1. **AI Report** (default) — fetches `GET /report/:incident_id` on mount and on `incident.id` change. Displays:
   - Summary text
   - Caller details
   - Recommended actions list
   - Dispatcher assigned (name, badge, desk)
   - Units dispatched (unit code, type, ETA, distance, crew lead)
   - Timeline events

2. **Transcript** — fetches `GET /incidents/:id/transcript` and renders per-utterance bubbles:
   - Caller turns: left-aligned, labeled "911"
   - Agent turns: right-aligned, labeled "AI"

**Dispatch panel** — rendered when `incident.status === "active"`:
- Dropdown of available units with code and type
- "Dispatch" button — disabled until a unit is selected
- Calls `onDispatch(incident.id, selectedUnit)` on submit

---

### UnitPanel

`frontend/src/components/UnitPanel.tsx`

The right-sidebar unit list. Fetches mock units with distance and ETA when an incident with a location is selected.

```tsx
<UnitPanel units={units} incidentLocation={selectedIncident?.caller_location} />
```

| Prop | Type | Description |
|---|---|---|
| `units` | `Unit[]` | Fallback plain DB units |
| `incidentLocation` | `string \| undefined` | `"lat,lng"` string — triggers `GET /units/mock?lat=&lng=` fetch |

**Behavior:**
- When `incidentLocation` is set (and parseable as `lat,lng`): fetches `GET /units/mock?lat=&lng=` and displays mock units with distance and ETA
- Falls back to plain `units` prop if the mock fetch fails

**Card design (white background, monochrome):**
- Semantic **status dot** (colored dot only — no colored border):
  - Green: `available`
  - Orange: `dispatched`
  - Blue: `on_scene`
  - Purple: `returning`
- Unit code label, type, zone, status text

**Expandable rows** — click a unit card to expand:
- Vehicle info (make, model, year, license plate)
- Crew list (name + role for each member)
- Equipment tags
- Assigned incident ID (if `current_incident_id` is set)
- Distance and ETA (if mock data)

---

## Types

`frontend/src/types/index.ts` is a manual mirror of `backend/src/types/index.ts`. It contains all shared TypeScript types used across the frontend:

- `Incident`, `IncidentStatus`, `IncidentType`, `IncidentPriority`
- `TranscriptionTurn`, `TranscriptionRole`
- `Unit`, `UnitType`, `UnitStatus`
- `Dispatch`
- `SseEvent`, `SseEventType`
- `WsClientMessage` and all subtypes (`WsCallStartMessage`, `WsAudioChunkMessage`, `WsCallEndMessage`)
- `WsServerMessage` and all subtypes (including `WsReportUpdateMessage`, `WsDispatcherApproachingMessage`)
- `IncidentReport`, `ReportTimelineEvent`, `DispatchedUnitSummary`, `DispatcherAssigned`
- `ApiSuccess<T>`, `ApiError`, `ApiResponse<T>`

> **Note:** These types are kept in sync manually. If you add a new field to the backend types, update the frontend types file as well.

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
