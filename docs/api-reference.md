# API Reference

All HTTP endpoints are served by the Bun backend on `http://localhost:3000` by default.

**Base URL:** `http://localhost:3000`

---

## Response format

All REST endpoints return JSON in one of two shapes:

**Success**
```json
{ "ok": true, "data": <payload> }
```

**Error**
```json
{ "ok": false, "error": "Human-readable error message" }
```

---

## Table of Contents

- [Health Check](#health-check)
- [Incidents](#incidents)
- [Units](#units)
- [Dispatch](#dispatch)
- [Protocols (RAG Search)](#protocols-rag-search)
- [Recordings](#recordings)
- [Report](#report)
- [Mock Data](#mock-data)
- [SSE — Live Events](#sse--live-events)
- [WebSocket — Emergency Calls](#websocket--emergency-calls)

---

## Health Check

### `GET /health`

Returns server status and current timestamp.

**Response**
```json
{
  "ok": true,
  "ts": "2026-03-15T10:00:00.000Z"
}
```

---

## Incidents

### `GET /incidents`

List incidents with optional filtering and pagination.

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `status` | string | — | Filter by status: `active`, `dispatched`, `resolved`, `cancelled` |
| `limit` | integer | `50` | Maximum number of results |
| `offset` | integer | `0` | Pagination offset |

**Example request**
```
GET /incidents?status=active&limit=10
```

**Example response**
```json
{
  "ok": true,
  "data": [
    {
      "id": "a1b2c3d4-...",
      "caller_id": "tel:+15551234001",
      "caller_location": "123 Oak Street, Springfield",
      "status": "active",
      "type": null,
      "priority": null,
      "summary": null,
      "created_at": "2026-03-15T09:58:00.000Z",
      "updated_at": "2026-03-15T09:58:00.000Z",
      "resolved_at": null,
      "s3_audio_prefix": null,
      "s3_transcript_key": null
    }
  ]
}
```

---

### `GET /incidents/:id`

Get a single incident by UUID.

**Path parameters**

| Parameter | Description |
|---|---|
| `id` | Incident UUID |

**Example response**
```json
{
  "ok": true,
  "data": {
    "id": "a1b2c3d4-...",
    "caller_id": "tel:+15551234001",
    "caller_location": "123 Oak Street, Springfield",
    "status": "dispatched",
    "type": "fire",
    "priority": "P1",
    "summary": "Structure fire at residential address.",
    "created_at": "2026-03-15T09:58:00.000Z",
    "updated_at": "2026-03-15T10:01:00.000Z",
    "resolved_at": null,
    "s3_audio_prefix": "recordings/a1b2c3d4-.../",
    "s3_transcript_key": "recordings/a1b2c3d4-.../transcript.json"
  }
}
```

**Error responses**

| Status | Condition |
|---|---|
| `404` | Incident not found |

---

### `PATCH /incidents/:id`

Update an incident's status, type, priority, summary, or resolved timestamp.

**Path parameters**

| Parameter | Description |
|---|---|
| `id` | Incident UUID |

**Request body** (all fields optional)
```json
{
  "status": "resolved",
  "type": "fire",
  "priority": "P1",
  "summary": "Fire extinguished, no injuries.",
  "resolved_at": "2026-03-15T10:15:00.000Z",
  "s3_audio_prefix": "recordings/a1b2c3d4-.../",
  "s3_transcript_key": "recordings/a1b2c3d4-.../transcript.json"
}
```

**Field values**

| Field | Allowed values |
|---|---|
| `status` | `active`, `dispatched`, `resolved`, `cancelled` |
| `type` | `fire`, `medical`, `police`, `traffic`, `hazmat`, `search_rescue`, `other` |
| `priority` | `P1` (life-threatening), `P2` (urgent), `P3` (standard), `P4` (non-urgent) |

**Example response**
```json
{
  "ok": true,
  "data": { /* updated Incident object */ }
}
```

**Notes**
- Updating an incident automatically broadcasts an `incident_updated` SSE event to all connected dashboard clients.
- Setting `status: "resolved"` does **not** automatically set `resolved_at` — pass both fields if needed.

---

### `GET /incidents/:id/transcript`

Get the transcription turns for a specific incident, ordered by `timestamp_ms`.

**Path parameters**

| Parameter | Description |
|---|---|
| `id` | Incident UUID |

**Example response**
```json
{
  "ok": true,
  "data": [
    {
      "id": "t1uuid...",
      "incident_id": "a1b2c3d4-...",
      "role": "agent",
      "text": "911, what is your emergency?",
      "timestamp_ms": 0,
      "created_at": "2026-03-15T09:58:00.500Z"
    },
    {
      "id": "t2uuid...",
      "incident_id": "a1b2c3d4-...",
      "role": "caller",
      "text": "There's a fire at my house!",
      "timestamp_ms": 2000,
      "created_at": "2026-03-15T09:58:02.500Z"
    }
  ]
}
```

> **Note:** This route is handled inside the incidents router as `GET /incidents/:id/transcript`.

---

## Units

### `GET /units`

List all dispatch units with optional filtering.

**Query parameters**

| Parameter | Type | Description |
|---|---|---|
| `status` | string | Filter by status: `available`, `dispatched`, `on_scene`, `returning` |
| `type` | string | Filter by type: `fire`, `ems`, `police`, `hazmat`, `rescue` |

**Example request**
```
GET /units?status=available&type=ems
```

**Example response**
```json
{
  "ok": true,
  "data": [
    {
      "id": "u1uuid...",
      "unit_code": "EMS-1",
      "type": "ems",
      "status": "available",
      "current_incident_id": null,
      "created_at": "2026-03-15T08:00:00.000Z",
      "updated_at": "2026-03-15T08:00:00.000Z"
    }
  ]
}
```

---

### `GET /units/:id`

Get a single unit by UUID.

**Example response**
```json
{
  "ok": true,
  "data": {
    "id": "u1uuid...",
    "unit_code": "FD-2",
    "type": "fire",
    "status": "dispatched",
    "current_incident_id": "a1b2c3d4-...",
    "created_at": "2026-03-15T08:00:00.000Z",
    "updated_at": "2026-03-15T09:59:00.000Z"
  }
}
```

---

### `POST /units`

Create a new unit. Intended for admin use or initial setup.

**Request body**
```json
{
  "unit_code": "EMS-7",
  "type": "ems",
  "status": "available"
}
```

| Field | Required | Description |
|---|---|---|
| `unit_code` | Yes | Unique identifier string, e.g. `EMS-7`, `FD-3` |
| `type` | Yes | `fire`, `ems`, `police`, `hazmat`, or `rescue` |
| `status` | No | Defaults to `available` |

**Response** — `201 Created`
```json
{
  "ok": true,
  "data": { /* Unit object */ }
}
```

---

### `PATCH /units/:id`

Update a unit's status and optionally assign or clear its current incident.

**Request body**
```json
{
  "status": "returning",
  "current_incident_id": null
}
```

| Field | Required | Description |
|---|---|---|
| `status` | Yes | `available`, `dispatched`, `on_scene`, or `returning` |
| `current_incident_id` | No | Incident UUID or `null` to clear |

---

## Dispatch

### `POST /dispatch`

Manually dispatch an available unit of a given type to an incident.

The system automatically selects the first available unit of the requested type. If no unit is available, a `500` error is returned.

**Request body**
```json
{
  "incident_id": "a1b2c3d4-...",
  "unit_type": "ems"
}
```

| Field | Required | Description |
|---|---|---|
| `incident_id` | Yes | UUID of the target incident |
| `unit_type` | Yes | `fire`, `ems`, `police`, `hazmat`, or `rescue` |

**Response** — `201 Created`
```json
{
  "ok": true,
  "data": {
    "dispatch": {
      "id": "d1uuid...",
      "incident_id": "a1b2c3d4-...",
      "unit_id": "u1uuid...",
      "dispatched_at": "2026-03-15T10:00:00.000Z",
      "arrived_at": null,
      "cleared_at": null
    },
    "unit": {
      "id": "u1uuid...",
      "unit_code": "EMS-1",
      "type": "ems",
      "status": "dispatched",
      "current_incident_id": "a1b2c3d4-..."
    }
  }
}
```

**Side effects**
- Unit status updated to `dispatched`
- Incident status updated to `dispatched`
- `unit_dispatched` SSE event broadcast to dashboard

---

### `GET /dispatch/:incident_id`

Get all dispatch records for a given incident.

**Path parameters**

| Parameter | Description |
|---|---|
| `incident_id` | Incident UUID |

**Example response**
```json
{
  "ok": true,
  "data": [
    {
      "id": "d1uuid...",
      "incident_id": "a1b2c3d4-...",
      "unit_id": "u1uuid...",
      "dispatched_at": "2026-03-15T10:00:00.000Z",
      "arrived_at": "2026-03-15T10:07:00.000Z",
      "cleared_at": null
    }
  ]
}
```

---

### `PATCH /dispatch/:dispatch_id/arrive`

Mark a dispatched unit as arrived on scene. Updates `dispatches.arrived_at` and sets the unit status to `on_scene`.

**Path parameters**

| Parameter | Description |
|---|---|
| `dispatch_id` | Dispatch record UUID |

**Request body**
```json
{ "unit_id": "u1uuid..." }
```

**Response**
```json
{ "ok": true, "data": { "arrived": true } }
```

---

### `PATCH /dispatch/:dispatch_id/clear`

Clear a unit from an incident (return to available). Updates `dispatches.cleared_at` and sets the unit status back to `available`.

**Path parameters**

| Parameter | Description |
|---|---|
| `dispatch_id` | Dispatch record UUID |

**Request body**
```json
{ "unit_id": "u1uuid..." }
```

**Response**
```json
{ "ok": true, "data": { "cleared": true } }
```

---

## Protocols (RAG Search)

### `GET /protocols/search`

Search ingested emergency protocol documents using semantic similarity. Returns the top matching chunks from LanceDB.

**Query parameters**

| Parameter | Required | Description |
|---|---|---|
| `q` | Yes | Natural-language query describing the situation |
| `limit` | No | Number of results (1–10, default `3`) |

**Example request**
```
GET /protocols/search?q=cardiac+arrest+CPR+instructions&limit=3
```

**Example response**
```json
{
  "ok": true,
  "data": [
    {
      "id": "chunk-uuid...",
      "source_file": "cardiac-arrest.md",
      "section": "CPR Protocol",
      "chunk_text": "Begin chest compressions immediately at a rate of 100-120 per minute...",
      "priority_keywords": ["cardiac", "arrest"],
      "score": 0.94
    },
    {
      "id": "chunk-uuid-2...",
      "source_file": "cardiac-arrest.md",
      "section": "AED Usage",
      "chunk_text": "Apply AED pads as shown in the diagram...",
      "priority_keywords": ["cardiac"],
      "score": 0.87
    }
  ]
}
```

**Notes**
- Requires protocol documents to have been ingested first via `bun run ingest:protocols`
- Results are ranked by cosine similarity of Titan Embeddings v2 vectors
- Used internally by the Nova Sonic agent when it fires the `get_protocol` tool call

---

## Recordings

### `GET /recordings/:incident_id/audio`

Get the S3 key prefix where audio chunks for this incident are stored.

**Path parameters**

| Parameter | Description |
|---|---|
| `incident_id` | Incident UUID |

**Example response**
```json
{
  "ok": true,
  "data": {
    "s3_prefix": "recordings/a1b2c3d4-.../"
  }
}
```

---

### `GET /recordings/:incident_id/playback?key=<s3-key>`

Get a presigned S3 URL to play back an audio chunk. URLs expire after 15 minutes.

**Path parameters**

| Parameter | Description |
|---|---|
| `incident_id` | Incident UUID |

**Query parameters**

| Parameter | Required | Description |
|---|---|---|
| `key` | Yes | Full S3 object key, e.g. `recordings/a1b2c3d4-.../audio_1710000000000.webm` |

**Example request**
```
GET /recordings/a1b2c3d4-.../playback?key=recordings/a1b2c3d4-.../audio_1710000000000.webm
```

**Example response**
```json
{
  "ok": true,
  "data": {
    "url": "https://s3.amazonaws.com/bucket/recordings/...?X-Amz-Signature=..."
  }
}
```

---

### `GET /recordings/:incident_id/transcript`

Get a presigned S3 URL for the full call transcript JSON. URLs expire after 15 minutes.

**Example response**
```json
{
  "ok": true,
  "data": {
    "url": "https://s3.amazonaws.com/bucket/recordings/.../transcript.json?X-Amz-Signature=..."
  }
}
```

**Notes**
- The transcript file is uploaded to S3 automatically when a call ends
- Format is a JSON array of `TranscriptionTurn` objects

---

## Report

### `GET /report/:incident_id`

Generate (or retrieve from cache) an AI-authored `IncidentReport` for a given incident. Used by `IncidentDetail.tsx` to populate the AI Report tab.

The report is generated by the Report Agent (`reportAgent.ts`) using AWS Bedrock Nova Lite. Results are cached in memory per incident and refreshed on each call.

**Path parameters**

| Parameter | Description |
|---|---|
| `incident_id` | Incident UUID |

**Example response**
```json
{
  "ok": true,
  "data": {
    "incident_id": "a1b2c3d4-...",
    "summary": "Residential structure fire with possible occupants inside.",
    "incident_type": "fire",
    "priority": "P1",
    "caller_details": "Caller at 123 Oak Street reporting flames on second floor.",
    "timeline": [
      { "timestamp_ms": 0, "event": "Caller: There's a fire at my house!" }
    ],
    "units_dispatched": [
      {
        "unit_code": "FD-1",
        "type": "fire",
        "eta_minutes": 4,
        "distance_km": 1.2,
        "crew_lead": "Captain Rodriguez",
        "crew": [{ "name": "Captain Rodriguez", "role": "Captain" }]
      }
    ],
    "dispatcher_assigned": {
      "id": "d1uuid...",
      "name": "Sarah Mitchell",
      "badge": "D-001",
      "desk": "Desk A",
      "certifications": ["EMD", "CPR"]
    },
    "recommended_actions": ["Ensure all occupants evacuate immediately"],
    "approaching_unit": null,
    "status": "dispatched",
    "generated_at": "2026-03-15T10:01:30.000Z"
  }
}
```

**Notes**
- The `approaching_unit` field is non-null when any dispatched unit has `eta_minutes <= 3`
- Dispatcher assignment is resolved by zone bbox matching from mock data — the dispatcher whose `assigned_zones` covers the caller's GPS location is selected; falls back to the first on-duty dispatcher
- Requires `GET /units/mock?lat=&lng=` to be resolvable (uses caller GPS coords)

**Error responses**

| Status | Condition |
|---|---|
| `404` | Incident not found |
| `500` | Report generation failed |

---

## Mock Data

### `GET /units/mock`

Returns all units from `backend/data/mock/dispatchers.json` enriched with haversine distance and ETA calculated from the given coordinates. Used by `UnitPanel.tsx` to show real-world distances and by the Report Agent to populate `units_dispatched`.

**Query parameters**

| Parameter | Required | Description |
|---|---|---|
| `lat` | Yes | Caller latitude (float) |
| `lng` | Yes | Caller longitude (float) |

**Example request**
```
GET /units/mock?lat=39.7817&lng=-89.6501
```

**Example response**
```json
{
  "ok": true,
  "data": [
    {
      "unit_code": "FD-1",
      "type": "fire",
      "status": "available",
      "zone": "ZONE-A",
      "station": "Station 1",
      "station_coords": { "lat": 39.7820, "lng": -89.6490 },
      "current_coords": { "lat": 39.7820, "lng": -89.6490 },
      "current_incident_id": null,
      "crew": [
        { "name": "Captain Rodriguez", "role": "Captain" },
        { "name": "FF Johnson", "role": "Firefighter" }
      ],
      "vehicle": {
        "make": "Pierce",
        "model": "Enforcer",
        "year": 2021,
        "license": "FD-1-IL",
        "vin": "1HTMM..."
      },
      "equipment": ["SCBA", "Jaws of Life", "Thermal Camera"],
      "distance_km": 0.4,
      "eta_minutes": 2
    }
  ]
}
```

**Notes**
- Distance is calculated using the haversine formula from the caller's coordinates to `current_coords`
- ETA is estimated at 40 km/h average speed: `(distance_km / 40) * 60` minutes, rounded to 1 decimal
- Returns all units regardless of status; the frontend filters by `status === "available"` for dispatch suggestions

---

### `GET /mock/dispatchers`

Returns the full mock dataset: dispatchers, zones, and hospitals. Used by `DispatcherDashboard.tsx` to populate the Dispatchers panel and zone chips in the nav bar.

**Example response**
```json
{
  "ok": true,
  "data": {
    "dispatchers": [
      {
        "id": "disp-001",
        "badge": "D-001",
        "name": "Sarah Mitchell",
        "shift": "day",
        "role": "Senior Dispatcher",
        "certifications": ["EMD", "CPR", "NIMS-700"],
        "station": { "desk": "Desk A" },
        "assigned_zones": ["ZONE-A", "ZONE-B"],
        "status": "on_duty"
      }
    ],
    "zones": [
      {
        "id": "ZONE-A",
        "name": "Downtown / North End",
        "risk_level": "high",
        "primary_units": ["FD-1", "EMS-1", "PD-1"]
      }
    ],
    "hospitals": [
      {
        "id": "hosp-001",
        "name": "Springfield Memorial",
        "coords": { "lat": 39.800, "lng": -89.644 },
        "trauma_level": "II",
        "ER_beds_available": 8,
        "helipad": true,
        "specialties": ["Trauma", "Cardiac", "Stroke"]
      }
    ]
  }
}
```

**Notes**
- Data is read directly from `backend/data/mock/dispatchers.json` — no database query
- The full Springfield IL mock dataset includes 5 dispatchers (3 on-duty day, 2 night off-duty), 5 zones, 12 units, and 3 hospitals
- `status` values for dispatchers: `"on_duty"`, `"off_duty"`

---

### `GET /events`

Opens a persistent Server-Sent Events stream for the dispatcher dashboard. Events are pushed whenever an incident is created, updated, classified, or a unit is dispatched.

**Headers returned**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Usage (browser)**
```javascript
const es = new EventSource("http://localhost:3000/events");
es.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data.event, data);
};
```

**Initial connection ping**

On connect, the server immediately sends a `ping` event to confirm the stream is open:
```
event: ping
data: {"event":"ping"}
```

### SSE event types

All events carry the following fields in the `data` JSON payload:

| Field | Type | Description |
|---|---|---|
| `event` | string | The event type (see below) |
| `incident_id` | string | UUID of the affected incident |
| `payload` | object | Event-specific data (see below) |
| `timestamp` | string | ISO 8601 timestamp |

#### `incident_created`

Fired when a new emergency call creates an incident (on `call_start` WebSocket message).

```json
{
  "event": "incident_created",
  "incident_id": "a1b2c3d4-...",
  "payload": { /* full Incident object */ },
  "timestamp": "2026-03-15T10:00:00.000Z"
}
```

#### `incident_updated`

Fired when `PATCH /incidents/:id` updates an incident.

```json
{
  "event": "incident_updated",
  "incident_id": "a1b2c3d4-...",
  "payload": { /* updated Incident object */ },
  "timestamp": "2026-03-15T10:01:00.000Z"
}
```

#### `incident_classified`

Fired when Nova Sonic's `classify_incident` tool call succeeds.

```json
{
  "event": "incident_classified",
  "incident_id": "a1b2c3d4-...",
  "payload": {
    "type": "fire",
    "priority": "P1",
    "incident": { /* updated Incident object */ }
  },
  "timestamp": "2026-03-15T10:00:30.000Z"
}
```

#### `unit_dispatched`

Fired when a unit is dispatched (via Nova Sonic tool call or `POST /dispatch`).

```json
{
  "event": "unit_dispatched",
  "incident_id": "a1b2c3d4-...",
  "payload": {
    "unit_id": "u1uuid...",
    "unit_code": "EMS-1",
    "unit_type": "ems",
    "dispatch_id": "d1uuid...",
    "dispatched_at": "2026-03-15T10:01:00.000Z"
  },
  "timestamp": "2026-03-15T10:01:00.000Z"
}
```

#### `call_ended`

Fired when a call terminates and the incident is finalized.

```json
{
  "event": "call_ended",
  "incident_id": "a1b2c3d4-...",
  "payload": { /* updated Incident object */ },
  "timestamp": "2026-03-15T10:15:00.000Z"
}
```

---

## WebSocket — Emergency Calls

### `WS /call`

Bidirectional WebSocket endpoint for live emergency call audio. Used by `CallerView.tsx` in the frontend.

**Connection**
```
ws://localhost:3000/call
```

The server uses Bun's native WebSocket implementation. No authentication is required in development. Each connection manages a single call session.

---

### Messages: Browser → Server

All messages are JSON strings.

#### `call_start`

Must be the first message sent after the WebSocket connection opens. Creates a new incident in libSQL and starts a Nova Sonic bidirectional stream.

```json
{
  "type": "call_start",
  "caller_id": "cal-a1b2c3d4",
  "location": "39.7817,-89.6501",
  "address": "123 Oak Street, Springfield, IL"
}
```

| Field | Type | Description |
|---|---|---|
| `caller_id` | string | Caller identifier (UUID generated by `useCallerInfo`, stored in `localStorage`) |
| `location` | string | GPS coordinates as `"lat,lng"` string from `navigator.geolocation` |
| `address` | string | Human-readable reverse-geocoded address (from OpenStreetMap Nominatim) |

**Server responds with** `call_accepted` if successful, or `error` if not.

---

#### `audio_chunk`

Stream PCM audio from the caller's microphone to Nova Sonic. Send continuously while the call is active.

```json
{
  "type": "audio_chunk",
  "data": "<base64-encoded PCM 16-bit 16kHz mono>"
}
```

| Field | Type | Description |
|---|---|---|
| `data` | string | Base64-encoded PCM audio — 16-bit, 16kHz, mono |

**Recommended chunk size:** ~32ms of audio (1024 samples = 2048 bytes before base64 encoding).

---

#### `call_end`

Signals a clean call termination. The server closes the Nova Sonic session, exports the transcript to S3, and sends `call_ended`.

```json
{
  "type": "call_end"
}
```

---

### Messages: Server → Browser

#### `call_accepted`

Sent immediately after a successful `call_start`. Provides the incident UUID.

```json
{
  "type": "call_accepted",
  "incident_id": "a1b2c3d4-..."
}
```

---

#### `audio_response`

Nova Sonic's voice response. Decode the base64 PCM and play it through the browser's `AudioContext`.

```json
{
  "type": "audio_response",
  "data": "<base64-encoded PCM 16-bit 24kHz mono>"
}
```

| Field | Description |
|---|---|
| `data` | Base64-encoded PCM — 16-bit, **24kHz**, mono |

**Important:** Output sample rate is **24kHz** (not 16kHz). Create your `AudioContext` with `sampleRate: 24000`.

---

#### `transcript_update`

A transcribed text turn from either the caller or the agent. Sent in real time during the call.

```json
{
  "type": "transcript_update",
  "role": "agent",
  "text": "911, what is your emergency?"
}
```

| Field | Values |
|---|---|
| `role` | `"agent"` or `"caller"` |
| `text` | Transcribed speech |

---

#### `incident_classified`

Sent when Nova Sonic has gathered enough information to classify the incident.

```json
{
  "type": "incident_classified",
  "incident_type": "fire",
  "priority": "P1"
}
```

---

#### `report_update`

Sent periodically (every ~30 seconds) and on key events (incident classified, unit dispatched) as the Report Agent generates an updated `IncidentReport`. The CallerView uses this to show the DispatcherCard, HelpBanner ETA, and ReportPanel.

```json
{
  "type": "report_update",
  "report": {
    "incident_id": "a1b2c3d4-...",
    "summary": "Residential structure fire with possible occupants inside.",
    "incident_type": "fire",
    "priority": "P1",
    "caller_details": "Caller at 123 Oak Street reporting flames on second floor.",
    "timeline": [
      { "timestamp_ms": 0, "event": "Caller: There's a fire at my house!" }
    ],
    "units_dispatched": [
      {
        "unit_code": "FD-1",
        "type": "fire",
        "eta_minutes": 4,
        "distance_km": 1.2,
        "crew_lead": "Captain Rodriguez",
        "crew": [{ "name": "Captain Rodriguez", "role": "Captain" }]
      }
    ],
    "dispatcher_assigned": {
      "id": "d1uuid...",
      "name": "Sarah Mitchell",
      "badge": "D-001",
      "desk": "Desk A",
      "certifications": ["EMD", "CPR"]
    },
    "recommended_actions": ["Ensure all occupants evacuate immediately"],
    "approaching_unit": null,
    "status": "dispatched",
    "generated_at": "2026-03-15T10:01:30.000Z"
  }
}
```

---

#### `dispatcher_approaching`

Sent when a dispatched unit's ETA drops to 3 minutes or less (detected by the Report Agent on each report generation cycle). Triggers the `ApproachingAlert` banner in CallerView.

```json
{
  "type": "dispatcher_approaching",
  "unit_code": "FD-1",
  "eta_minutes": 2,
  "crew": [
    { "name": "Captain Rodriguez", "role": "Captain" },
    { "name": "FF Johnson", "role": "Firefighter" }
  ]
}
```

---

#### `error`

Sent on any server-side or AI session error.

```json
{
  "type": "error",
  "message": "No active call session"
}
```

Common error messages:

| Message | Cause |
|---|---|
| `"No active call session"` | `audio_chunk` or `call_end` sent before `call_start` |
| `"Call already in progress"` | Second `call_start` on same connection |
| `"Failed to create incident: ..."` | libSQL error during incident creation |
| `"Failed to start AI session: ..."` | Bedrock connection failure |
| `"AI session error: ..."` | Nova Sonic runtime error |

---

#### `call_ended`

Final message sent when the call terminates (either from `call_end` message, Nova Sonic ending the session, or an error).

```json
{
  "type": "call_ended",
  "incident_id": "a1b2c3d4-..."
}
```

---

### Full call sequence example

```
Browser                         Server                          Nova Sonic / Report Agent
  |                               |                                |
  |-- WS connect /call ---------->|                                |
  |                               |                                |
  |-- call_start ----------------->|                                |
  |   { caller_id, location,      |                                |
  |     address }                 |-- create incident in libSQL    |
  |                               |-- open bidirectional stream -->|
  |<-- call_accepted -------------|                                |
  |                               |                              [greets caller]
  |<-- audio_response (greeting) -|<-- audio output --------------|
  |                               |                                |
  |-- audio_chunk (mic) ---------->|-- sendAudio ----------------->|
  |-- audio_chunk (mic) ---------->|-- sendAudio ----------------->|
  |                               |                              [transcribes]
  |<-- transcript_update (caller) -|<-- textOutput: caller --------|
  |<-- transcript_update (agent) --|<-- textOutput: agent  --------|
  |<-- audio_response ------------|<-- audio output --------------|
  |                               |                                |
  |                               |                [classify_incident tool]
  |<-- incident_classified --------|<-- tool call + execute -------|
  |                               |                                |
  |                               |              [dispatch_unit tool]
  |                               |-- dispatch EMS unit            |
  |                               |-- SSE: unit_dispatched         |
  |                               |                                |
  |                               |-- Report Agent: generateReport()
  |<-- report_update --------------|   (Nova Lite, every ~30s or   |
  |                               |    on classify/dispatch event) |
  |                               |                                |
  |  (if approaching_unit != null)|                                |
  |<-- dispatcher_approaching -----|   (ETA <= 3 min detected)     |
  |                               |                                |
  |-- call_end ------------------>|                                |
  |                               |-- session.close() ----------->|
  |                               |-- export transcript to S3      |
  |                               |-- update incident              |
  |<-- call_ended -----------------|                                |
```

---

## Error Codes Summary

| HTTP Status | Meaning |
|---|---|
| `200` | Success |
| `201` | Created |
| `204` | No content (CORS preflight) |
| `400` | Bad request (missing or invalid fields) |
| `404` | Resource not found |
| `405` | Method not allowed |
| `426` | WebSocket upgrade required |
| `500` | Internal server error |
