# Frontend Guide

The frontend is a React 18 + TypeScript + Vite SPA in `frontend/`.

---

## Table of Contents

- [Setup](#setup)
- [Project Structure](#project-structure)
- [Routing](#routing)
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
├── types/index.ts
├── hooks/
│   ├── useCallerInfo.ts
│   ├── useCallSocket.ts
│   ├── useIncidents.ts
│   └── useUnits.ts
├── components/
│   ├── Badges.tsx
│   ├── IncidentList.tsx
│   ├── IncidentDetail.tsx
│   └── UnitPanel.tsx
└── pages/
    ├── CallerView.tsx
    └── DispatcherDashboard.tsx
```

---

## Routing

| Path | Component | Notes |
|---|---|---|
| `/` | `CallerView` | Caller UI; starts call on explicit "Call 911" click |
| `/dashboard` | `DispatcherDashboard` | Dispatcher operations UI |
| `*` | Redirect | Fallback to `/` |

---

## Hooks

### `useCallSocket`

Manages caller-side WebSocket and audio pipeline.

Current capture/playback behavior:
- capture uses `ScriptProcessorNode` and sends raw PCM16 16kHz mono
- playback uses `AudioContext` resume guard and queued 24kHz PCM output
- includes `stopCapture()` cleanup path

Returns include call status, transcript, report, approaching unit, and start/end controls.

### `useIncidents`

Combines initial REST load with continuous SSE updates.

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

### `DispatcherDashboard.tsx`

Integrates updated incident hook and incident detail contract:
- passes `extraction` and `escalation` into `IncidentDetail`
- dispatch handler calls `POST /dispatch/accept` with `unit_ids[]` and `officer_id`
- stats reflect broader lifecycle statuses
- empty-state messaging updated for new workflow

---

## Type Model

`frontend/src/types/index.ts` mirrors backend shared types manually.

Major additions:
- expanded `IncidentStatus` (8 values)
- dispatch extension fields on `Incident`
- extended `SseEventType` set
- `Department`
- `DispatchAction`
- `IncidentUnit`
- `DispatchQuestion`
- `ExtractionData`
- `EscalationSuggestion`
- `DashboardSsePayload`

`DashboardSsePayload` union includes:
- `incident_created`
- `incident_classified`
- `transcript_update`
- `extraction_update`
- `answer_update`
- `unit_dispatched`
- `status_change`
- `escalation_suggestion`
- `incident_completed`

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
