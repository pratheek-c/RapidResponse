# API Reference

All backend endpoints are served by Bun (`http://localhost:3000` by default).

Base URL: `http://localhost:3000`

---

## Response Format

Success shape:

```json
{ "ok": true, "data": {} }
```

Error shape:

```json
{ "ok": false, "error": "Human-readable message" }
```

---

## Table of Contents

- [Health](#health)
- [Incidents](#incidents)
- [Units](#units)
- [Dispatch](#dispatch)
- [Protocols](#protocols)
- [Recordings](#recordings)
- [Reports](#reports)
- [Mock Data](#mock-data)
- [SSE Events](#sse-events)
- [WebSocket Call API](#websocket-call-api)

---

## Health

### `GET /health`

Returns service heartbeat.

---

## Incidents

### `GET /incidents`

List incidents.

Query params:

| Param | Type | Default | Notes |
|---|---|---|---|
| `status` | string | none | One of `active`, `classified`, `dispatched`, `en_route`, `on_scene`, `completed`, `resolved`, `cancelled` |
| `limit` | integer | `50` | Max rows |
| `offset` | integer | `0` | Pagination offset |

---

### `GET /incidents/resolved`

Returns both `resolved` and `completed` incidents, merged and sorted by `updated_at DESC`.

Query params:

| Param | Type | Default |
|---|---|---|
| `limit` | integer | `50` |
| `offset` | integer | `0` |

---

### `GET /incidents/:id`

Returns a single incident.

---

### `PATCH /incidents/:id`

Patch an incident.

Supported fields:
- `status` (`active | classified | dispatched | en_route | on_scene | completed | resolved | cancelled`)
- `type` (`fire | medical | police | traffic | hazmat | search_rescue | other`)
- `priority` (`P1 | P2 | P3 | P4`)
- `summary`, `resolved_at`, `s3_audio_prefix`, `s3_transcript_key`
- dispatch extension fields: `accepted_at`, `completed_at`, `escalated`, `officer_id`, `assigned_units`

---

### `GET /incidents/:id/transcript`

Returns transcription turns ordered by `timestamp_ms`.

---

### `GET /incidents/:id/actions`

Returns dispatch action audit rows from `dispatch_actions`.

Example action types:
- `accept`
- `escalate`
- `question`
- `complete`
- `save_report`

---

### `GET /incidents/:id/questions`

Returns dispatcher Q&A rows from `dispatch_questions`.

Fields include:
- `question`
- `refined_question`
- `answer`
- `asked_at`
- `answered_at`

---

### `GET /incidents/:id/units`

Returns assigned unit rows for the incident from `incident_units`.

Each row includes:
- `unit_id`, `unit_type`
- lifecycle `status` (`dispatched | en_route | on_scene`)
- `dispatched_at`, `arrived_at`

---

## Units

### `GET /units`

List units.

Query params:

| Param | Type | Notes |
|---|---|---|
| `status` | string | `available | dispatched | on_scene | returning` |
| `type` | string | `fire | ems | police | hazmat | rescue` |

---

### `GET /units/:id`

Get one unit.

---

### `POST /units`

Create unit.

Body:

```json
{
  "unit_code": "EMS-7",
  "type": "ems",
  "status": "available"
}
```

---

### `PATCH /units/:id`

Update unit status and optionally `current_incident_id`.

---

### `GET /units/mock?lat=&lng=`

Returns mock units enriched with distance and ETA.

---

## Dispatch

### Legacy dispatch endpoints

#### `POST /dispatch`

Legacy manual dispatch (auto-selects first available unit of requested `unit_type`).

Body:

```json
{ "incident_id": "...", "unit_type": "ems" }
```

#### `GET /dispatch/:incident_id`

Returns legacy `dispatches` rows for incident.

#### `PATCH /dispatch/:dispatch_id/arrive`

Body:

```json
{ "unit_id": "..." }
```

#### `PATCH /dispatch/:dispatch_id/clear`

Body:

```json
{ "unit_id": "..." }
```

---

### Dashboard dispatch endpoints

#### `POST /dispatch/accept`

Accept incident, assign units, set officer.

Body:

```json
{
  "incident_id": "...",
  "unit_ids": ["unit-1", "unit-2"],
  "officer_id": "D-201"
}
```

Effects:
- writes `dispatch_actions` (`accept`)
- writes `incident_units`
- updates `units` status to `dispatched`
- updates incident (`status=dispatched`, `accepted_at`, `officer_id`, `assigned_units`)
- emits SSE `status_change`

---

#### `POST /dispatch/question`

Ask question through AI bridge.

Body:

```json
{
  "incident_id": "...",
  "question": "Is anyone trapped inside?",
  "officer_id": "D-201"
}
```

Behavior:
- logs action (`question`)
- refines spoken question through Nova Lite
- stores row in `dispatch_questions`
- injects into active Nova Sonic session when available
- if session inactive, attempts transcript answer extraction and emits SSE `answer_update`

---

#### `POST /dispatch/escalate`

Escalate incident and request additional department types.

Body:

```json
{
  "incident_id": "...",
  "reason": "Possible mass casualty risk",
  "requested_unit_types": ["medical", "fire"]
}
```

`requested_unit_types` uses API-level `Department` values:
- `patrol`
- `medical`
- `fire`
- `hazmat`

Effects:
- logs action (`escalate`)
- updates incident (`status=en_route`, `escalated=1`)
- emits SSE `status_change`

---

#### `POST /dispatch/complete`

Mark incident completed.

Body:

```json
{
  "incident_id": "...",
  "officer_notes": "Optional notes"
}
```

Effects:
- logs action (`complete`)
- updates incident (`status=completed`, `completed_at`)
- emits SSE `status_change`

---

#### `POST /dispatch/save-report`

Save report summary and emit completion event.

Body:

```json
{
  "incident_id": "...",
  "summary": "Final report text"
}
```

Behavior:
- logs action (`save_report`)
- loads transcript + dispatch action history
- attempts close-summary synthesis via Nova Lite (`generateCloseSummary`)
- updates incident summary
- emits SSE `incident_completed`

---

## Protocols

### `GET /protocols/search?q=&limit=`

Semantic search over ingested protocol chunks.

---

## Recordings

### `GET /recordings/:incident_id/audio`

Returns S3 audio prefix for incident.

### `GET /recordings/:incident_id/playback?key=`

Returns presigned URL for audio object key.

### `GET /recordings/:incident_id/transcript`

Returns presigned URL for transcript export JSON.

---

## Reports

### `GET /report/:incident_id`

Returns generated/cached AI incident report.

---

## Mock Data

### `GET /mock/dispatchers`

Returns static dispatcher/zones/hospitals/units mock dataset from `backend/data/mock/dispatchers.json`.

---

## SSE Events

Endpoint: `GET /events`

Headers:
- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`

### Event payload families

Legacy shape (`sseSend`):

```json
{
  "event": "incident_created",
  "incident_id": "...",
  "payload": {},
  "timestamp": "..."
}
```

Dashboard shape (`pushSSE`):

```json
{
  "incident_id": "...",
  "status": "dispatched"
}
```

### Dashboard event types (9)

| Event | Payload |
|---|---|
| `incident_created` | `{ incident_id, created_at }` |
| `incident_classified` | `{ incident_id, incident_type, priority }` |
| `transcript_update` | `{ incident_id, role: "caller"|"ai", text, timestamp }` |
| `extraction_update` | `{ incident_id, extraction }` |
| `answer_update` | `{ incident_id, question, answer }` |
| `unit_dispatched` | `{ incident_id, unit_id, unit_type }` |
| `status_change` | `{ incident_id, status, unit_id? }` |
| `escalation_suggestion` | `{ incident_id, reason, suggested_units }` |
| `incident_completed` | `{ incident_id, summary }` |

### Legacy event types still present

- `incident_created`
- `incident_updated`
- `incident_classified`
- `unit_dispatched`
- `transcription_turn`
- `call_ended`

---

## WebSocket Call API

Endpoint: `WS /call`

### Browser -> Server

#### `call_start`

```json
{
  "type": "call_start",
  "caller_id": "caller-uuid",
  "location": "39.7817,-89.6501",
  "address": "123 Main St"
}
```

#### `audio_chunk`

```json
{
  "type": "audio_chunk",
  "data": "<base64 pcm16 16khz mono>"
}
```

#### `call_end`

```json
{ "type": "call_end" }
```

### Server -> Browser

- `call_accepted`
- `audio_response` (base64 PCM16 24kHz)
- `transcript_update`
- `incident_classified`
- `report_update`
- `dispatcher_approaching`
- `error`
- `call_ended`

---

## Error Statuses

| Status | Meaning |
|---|---|
| `200` | OK |
| `201` | Created |
| `204` | CORS preflight |
| `400` | Invalid request body/params |
| `404` | Resource not found |
| `405` | Method not allowed |
| `426` | WS upgrade required |
| `500` | Server/internal failure |
