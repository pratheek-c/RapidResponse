# Architecture

This document describes the system design, data flow, and service layer of RapidResponse.ai.

---

## Table of Contents

- [High-Level Overview](#high-level-overview)
- [Technology Choices](#technology-choices)
- [Data Storage](#data-storage)
- [Full Call Lifecycle](#full-call-lifecycle)
- [Backend Service Layer](#backend-service-layer)
- [Nova Sonic Agent](#nova-sonic-agent)
- [RAG Pipeline](#rag-pipeline)
- [SSE Event Bus](#sse-event-bus)
- [Database Schema](#database-schema)

---

## High-Level Overview

```
┌─────────────────────────┐       ┌────────────────────────────────────────┐
│  Browser — CallerView   │       │  Browser — DispatcherDashboard         │
│                         │       │                                        │
│  getUserMedia (mic)     │       │  EventSource /events (SSE)             │
│  PCM audio → base64     │       │  REST reads: /incidents, /units        │
│  WebSocket /call        │       │  REST writes: /dispatch                │
└────────────┬────────────┘       └──────────────┬─────────────────────────┘
             │ WS                                │ HTTP
             ▼                                  ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                        Bun HTTP + WebSocket Server                         │
│                              (server.ts)                                   │
│                                                                            │
│  WS /call ──► callHandler.ts ──► novaAgent.ts ──► AWS Bedrock Nova Sonic  │
│                    │                                                        │
│                    └──► reportAgent.ts ──► AWS Bedrock Nova Lite           │
│                                                                            │
│  GET  /incidents[/:id]     GET  /recordings/...                            │
│  PATCH /incidents/:id      GET  /protocols/search                          │
│  GET  /units[/:id]         GET  /events (SSE)                              │
│  POST/PATCH /units/:id     GET  /health                                    │
│  POST  /dispatch           GET  /report/:incident_id                       │
│  GET   /dispatch/:id       GET  /mock/dispatchers                          │
│  PATCH /dispatch/:id/arrive|clear                                          │
│  GET   /units/mock?lat=&lng=                                               │
└─────────────────────────┬──────────────────────────────────────────────────┘
                          │
          ┌───────────────┼──────────────────┐
          ▼               ▼                  ▼
  ┌──────────────┐  ┌───────────┐   ┌──────────────────┐
  │   libSQL     │  │  LanceDB  │   │    AWS S3         │
  │  (SQLite)    │  │ (vectors) │   │  (audio/          │
  │              │  │           │   │   transcripts)    │
  │ incidents    │  │ protocols │   │                   │
  │ transcripts  │  │ incidents │   │ recordings/       │
  │ units        │  │ locations │   │ {incident_id}/    │
  │ dispatches   │  │           │   │ audio_*.webm      │
  └──────────────┘  └───────────┘   │ transcript.json   │
                                    └──────────────────┘
```

---

## Technology Choices

| Concern | Technology | Why |
|---|---|---|
| Runtime | Bun | Native TypeScript, fast startup, built-in WebSocket, test runner |
| Voice AI | AWS Bedrock Nova Sonic 2 | Real-time bidirectional audio + text, tool use, no OpenAI dependency |
| Embeddings | AWS Bedrock Titan Embeddings v2 | 1024-dim vectors, compatible with LanceDB cosine search |
| Vector DB | LanceDB (embedded) | Zero-dependency, runs in-process, Arrow-native |
| Relational DB | libSQL (embedded SQLite) | Zero-dependency, supports networked sqld if needed, parameterized queries |
| Audio storage | AWS S3 | Durable object storage, presigned URL playback |
| HTTP/WS server | Bun.serve() | No express, no ws package, WebSocket upgrade built in |
| Frontend | React 18 + Vite | Fast HMR, standard React ecosystem |
| Frontend routing | React Router v6 | Client-side routing for `/` (CallerView) and `/dashboard` |
| Report Agent | AWS Bedrock Nova Lite | Periodic structured incident report generation (non-streaming) |

---

## Data Storage

The three data stores are strictly separated:

| Store | Data | Never store |
|---|---|---|
| libSQL | incidents, transcription turns, units, dispatches | embeddings, audio binary |
| LanceDB | protocol embeddings, incident embeddings, location vectors | structured relational data |
| S3 | raw audio (`.webm`), transcript JSON | relational data, embeddings |

**IDs:** All primary keys are UUIDs generated with `crypto.randomUUID()`. No auto-increment integers.

**Timestamps:** All timestamps are stored as ISO 8601 strings in TEXT columns in libSQL.

**Migrations:** Managed with numbered SQL files in `backend/src/db/migrations/`. Rules:
- Never modify an existing migration file
- Always add a new numbered migration for schema changes
- The migration runner tracks applied versions in the `schema_migrations` table

---

## Full Call Lifecycle

```
1.  Caller opens / in browser
2.  useCallerInfo() generates a persistent callerId (localStorage), requests GPS,
    and reverse-geocodes coordinates via OpenStreetMap Nominatim
3.  CallerView auto-arms: calls startCall(callerId, location, address) on mount
4.  Browser opens WebSocket to ws://backend/call
5.  Browser sends: { type: "call_start", caller_id: "...", location: "lat,lng", address: "..." }
6.  callHandler.ts creates incident in libSQL (status: "active")
7.  callHandler.ts fires SSE: incident_created → dashboard
8.  callHandler.ts opens Nova Sonic bidirectional stream (novaAgent.ts)
9.  Server sends: { type: "call_accepted", incident_id: "..." }

During call:
10. Browser captures PCM audio via MediaRecorder (32ms chunks)
11. Browser sends: { type: "audio_chunk", data: "<base64 PCM 16kHz>" }
12. callHandler forwards audio to novaAgent.sendAudio()
13. novaAgent sends audioInput events to Bedrock HTTP/2 stream
14. Bedrock responds with audioOutput → base64 PCM 24kHz
15. novaAgent calls callbacks.onAudioOutput(base64Pcm)
16. callHandler sends: { type: "audio_response", data: "..." } to browser
17. Browser decodes PCM and plays through AudioContext (24kHz)

Transcription:
18. Bedrock sends textOutput events with transcribed turns
19. novaAgent calls callbacks.onTranscript(role, text)
20. callHandler saves turn to libSQL (fire-and-forget)
21. callHandler sends: { type: "transcript_update", role, text } to browser

Barge-in:
22. If caller interrupts agent: textOutput has { interrupted: true }
23. novaAgent sends "__FLUSH__" sentinel to callbacks.onAudioOutput
24. Frontend flushes pending audio queue

Incident classification:
25. Nova Sonic fires classify_incident tool when it has enough info
26. novaAgent.executeTool() calls incidentService.classifyIncident()
27. incidentService updates libSQL, fires SSE: incident_classified
28. callHandler sends: { type: "incident_classified", ... } to browser

RAG protocol lookup:
29. Nova Sonic fires get_protocol tool
30. novaAgent.executeTool() calls ragService.searchProtocols(query, 3)
31. ragService embeds query with Titan Embeddings v2
32. ragService queries LanceDB protocols collection (cosine similarity)
33. Top-3 chunks returned as context injected into Nova Sonic next turn

Unit dispatch:
34. Nova Sonic fires dispatch_unit tool
35. novaAgent.executeTool() calls dispatchService.dispatchUnit()
36. dispatchService finds first available unit of requested type
37. dispatchService creates dispatch record, updates unit + incident status
38. dispatchService fires SSE: unit_dispatched → dashboard

Report generation (Report Agent):
39. callHandler triggers generateReport() on: incident classified, unit dispatched,
    and every ~30s via interval timer
40. reportAgent.ts calls GET /units/mock?lat=&lng= to get units with distance/ETA
41. reportAgent.assignDispatcher() matches caller GPS to zone bbox, selects on-duty dispatcher
42. reportAgent.generateReport() calls Bedrock Nova Lite (InvokeModelCommand) with
    transcript + context, produces structured IncidentReport JSON
43. callHandler sends: { type: "report_update", report: IncidentReport } to browser
44. If any dispatched unit has eta_minutes <= 3:
    callHandler sends: { type: "dispatcher_approaching", unit_code, eta_minutes, crew } to browser

Call end:
45. Caller sends { type: "call_end" } OR Nova Sonic ends session
46. callHandler calls session.close()
47. callHandler exports transcript JSON from libSQL
48. callHandler uploads transcript JSON to S3
49. callHandler updates incident with s3_transcript_key
50. callHandler sends: { type: "call_ended", incident_id } to browser
51. SSE: call_ended broadcast to dashboard
```

**Session renewal:** Nova Sonic has an 8-minute maximum session duration. A timer fires at 7m30s and triggers `callbacks.onEnd("session_renewal")`. Session renewal for very long calls is flagged as a TODO in `callHandler.ts`.

---

## Backend Service Layer

The backend services layer (`backend/src/services/`) provides a clean abstraction between the HTTP/WebSocket handlers and the database/AWS clients.

### `incidentService.ts`

High-level incident CRUD. Every write operation also fires an SSE event.

| Function | Description |
|---|---|
| `createIncident(input)` | Create incident, broadcast `incident_created` |
| `getIncident(id)` | Fetch a single incident by UUID |
| `listIncidents(opts)` | List with optional status/pagination filters |
| `updateIncident(id, input)` | Update fields, broadcast `incident_updated` |
| `classifyIncident(id, type, priority)` | Set type + priority, broadcast `incident_classified` |
| `resolveIncident(id, summary)` | Set status=resolved, broadcast `call_ended` |

### `dispatchService.ts`

Unit dispatch logic triggered by Nova Sonic or manual API calls.

| Function | Description |
|---|---|
| `dispatchUnit(incident_id, unit_type)` | Find available unit, create dispatch, update statuses, broadcast `unit_dispatched` |
| `markUnitArrived(dispatch_id, unit_id)` | Set `arrived_at`, update unit to `on_scene` |
| `clearUnit(dispatch_id, unit_id)` | Set `cleared_at`, return unit to `available` |

### `ragService.ts`

Vector search over protocol documents.

| Function | Description |
|---|---|
| `searchProtocols(query, limit)` | Embed query with Titan v2, cosine search LanceDB `protocols` collection |
| `upsertProtocolChunk(chunk)` | Store a protocol chunk with its embedding |

### `transcriptionService.ts`

Save and export call transcripts.

| Function | Description |
|---|---|
| `saveAgentTurn(incident_id, text, ms)` | Save agent transcription turn to libSQL |
| `saveCallerTurn(incident_id, text, ms)` | Save caller transcription turn to libSQL |
| `exportTranscript(incident_id)` | Fetch all turns ordered by timestamp, return as JSON array |

### `storageService.ts`

S3 audio chunk and transcript management.

| Function | Description |
|---|---|
| `uploadAudioChunk(incident_id, buffer)` | Upload audio chunk, return S3 key |
| `uploadTranscript(incident_id, data)` | Upload transcript JSON, return S3 key |
| `getAudioPlaybackUrl(key)` | Generate presigned GET URL (15 min expiry) |
| `getTranscriptUrl(incident_id)` | Generate presigned GET URL for transcript |
| `audioChunkKey(incident_id)` | Generate S3 key for an audio chunk |
| `transcriptKey(incident_id)` | Generate S3 key for a transcript |

### `sseService.ts`

In-process SSE client registry and broadcast.

| Function | Description |
|---|---|
| `sseRegister()` | Register a new client, return the `Response` to send |
| `sseUnregister(clientId)` | Remove a client |
| `sseBroadcast(event)` | Push event to all connected clients |
| `sseSend(type, incident_id, payload)` | Convenience wrapper for `sseBroadcast` |
| `sseClientCount()` | Returns number of connected clients |

### `mockRoute.ts`

Serves static mock data from `backend/data/mock/dispatchers.json`. No database query involved.

| Route | Description |
|---|---|
| `GET /mock/dispatchers` | Returns all dispatchers, zones, and hospitals from mock JSON |
| `GET /units/mock?lat=&lng=` | Returns all mock units enriched with haversine distance + ETA from given coords |

---

## Report Agent

`backend/src/agents/reportAgent.ts` generates structured incident reports during active calls using AWS Bedrock Nova Lite.

### Overview

Unlike Nova Sonic (which uses a bidirectional streaming session), the Report Agent uses `InvokeModelCommand` — a standard synchronous request/response call. It is triggered:

- When an incident is classified (`classify_incident` tool fires)
- When a unit is dispatched (`dispatch_unit` tool fires)
- On a repeating ~30-second interval during the call

### `generateReport(ctx: ReportContext): Promise<IncidentReport>`

Takes a `ReportContext` containing:

| Field | Description |
|---|---|
| `incident_id` | UUID of the active incident |
| `caller_location` | `"lat,lng"` GPS string |
| `caller_address` | Human-readable address |
| `incident_type` | Classified type, or `null` |
| `priority` | Classified priority, or `null` |
| `status` | Current incident status |
| `call_start_ms` | Unix timestamp of call start |
| `transcript` | All `TranscriptionTurn[]` so far |
| `dispatched_units` | `MockUnitWithDistance[]` — units with distance + ETA |
| `assigned_dispatcher_id` | If already assigned, this dispatcher is used; otherwise `assignDispatcher()` is called |
| `mock_data` | Full mock dataset (dispatchers, zones, hospitals) |

**Steps:**

1. **Dispatcher assignment** — `assignDispatcher()` detects the S2-style zone bbox that contains the caller GPS coordinates, then picks the first on-duty dispatcher whose `assigned_zones` includes that zone. Falls back to the first on-duty dispatcher if no zone match.

2. **Unit summaries** — `buildDispatchedUnits()` converts `MockUnitWithDistance[]` → `DispatchedUnitSummary[]` (including `crew_lead`, `eta_minutes`, `distance_km`).

3. **Timeline** — `buildTimeline()` samples every 3rd caller turn, truncated to 120 characters each, to keep the report concise.

4. **Nova Lite call** — Sends the last 20 transcript turns + context to Nova Lite with `maxTokens: 512, temperature: 0.2`. The model returns JSON with `summary`, `caller_details`, `recommended_actions`.

5. **Approaching unit** — Any dispatched unit with `eta_minutes <= 3` is surfaced as `approaching_unit` in the report. This is used by the call handler to send `dispatcher_approaching` WS messages.

6. **Fallback** — If Nova Lite throws, pre-filled default strings are used and the error is logged. The report is always returned, never null.

### `assignDispatcher(callerLocation, mockData): MockDispatcher | null`

Exported separately for use outside the report generation cycle (e.g. immediate assignment on call start).

Zone detection parses `"lat,lng"`, then checks each zone's `bbox.sw` / `bbox.ne` for containment. Falls back to first on-duty dispatcher if no zone is matched.

`backend/src/agents/novaAgent.ts` manages the AWS Bedrock Nova Sonic 2 bidirectional stream.

### Stream setup

Nova Sonic uses HTTP/2 only. The Bedrock SDK requires `NodeHttp2Handler` from `@smithy/node-http-handler`:

```typescript
const client = new BedrockRuntimeClient({
  requestHandler: new NodeHttp2Handler({
    requestTimeout: 480000,  // 8 minutes
    sessionTimeout: 480000,
  }),
});
```

The stream input sequence:
1. `sessionStart` — inference configuration (maxTokens, topP, temperature)
2. `promptStart` — system prompt, tool specs, audio/text I/O configuration
3. `contentBlockStart` (type: AUDIO) — opens the caller audio block
4. Streaming `audioInput` events — one per ~32ms audio chunk
5. `contentBlockEnd` — closes the audio block
6. `promptEnd` → `sessionEnd` — terminates the stream

### Tool use

Nova Sonic fires tool calls via three tools defined in the system prompt:

| Tool | Trigger | Backend action |
|---|---|---|
| `classify_incident` | AI has enough info to classify | `incidentService.classifyIncident()` |
| `get_protocol` | AI needs protocol guidance | `ragService.searchProtocols()` |
| `dispatch_unit` | AI decides to dispatch a unit | `dispatchService.dispatchUnit()` |

**Critical:** Tool results must be sent after `contentEnd` with `stopReason: "TOOL_USE"` — not on the `toolUse` event itself. The tool result is sent as a `TOOL_RESULT` content block.

### Barge-in

When a caller interrupts the agent mid-sentence, Bedrock sends `{ "interrupted": true }` in the `textOutput` event. The agent sends a `"__FLUSH__"` sentinel to the `onAudioOutput` callback. The call handler recognizes this and does not forward it to the browser — the frontend `useCallSocket` hook clears its audio playback queue.

### Session renewal

Maximum session duration is 8 minutes. A `setTimeout` fires at 7m30s and calls `callbacks.onEnd("session_renewal")`, giving the call handler an opportunity to start a new Nova Sonic session and seamlessly continue the call.

---

## RAG Pipeline

```
Protocol document (.txt / .md / .pdf)
          │
          ▼
    chunkDocument()
    ─────────────
    Split on # headers / ALL CAPS lines
    Max 2048 chars per chunk
    200-char overlap between chunks
          │
          ▼
    extractPriorityKeywords()
    ─────────────────────────
    Detect keywords: fire, cardiac, overdose, etc.
          │
          ▼
    embedText() → Bedrock Titan Embeddings v2
    ─────────────────────────────────────────
    Returns Float32Array[1024]
          │
          ▼
    LanceDB protocols table
    ────────────────────────
    id, source_file, section, chunk_text,
    priority_keywords, embedding (1024-dim)
```

**Query time** (during a call):
1. Nova Sonic fires `get_protocol` tool with a query string
2. `ragService.searchProtocols(query, 3)` embeds the query with Titan v2
3. LanceDB cosine similarity search returns top-3 chunks
4. Chunks are formatted and returned as the tool result
5. Nova Sonic incorporates the protocol context in its next response

**Important:** All LanceDB searches and index operations use `distanceType("cosine")`. Using the default `"l2"` produces incorrect results with Titan embeddings.

---

## SSE Event Bus

The SSE service maintains an in-process `Map<clientId, ReadableStreamController>`. All service layer functions that mutate data call `sseSend()` directly — there is no separate message queue.

Events are delivered in real time to all connected dispatcher dashboard clients. Disconnected clients are pruned lazily when a write to their stream controller throws.

**Event flow:**

```
incidentService.createIncident()
        │
        └──► sseSend("incident_created", incident_id, incident)
                    │
                    └──► sseBroadcast(event)
                                │
                                └──► for each client: controller.enqueue(encoded)
```

---

## Database Schema

### `incidents`

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID |
| `caller_id` | TEXT NOT NULL | Caller identifier |
| `caller_location` | TEXT NOT NULL | GPS coordinates (`"lat,lng"`) |
| `caller_address` | TEXT | Human-readable reverse-geocoded address |
| `status` | TEXT | `active`, `dispatched`, `resolved`, `cancelled` |
| `type` | TEXT | `fire`, `medical`, `police`, `traffic`, `hazmat`, `search_rescue`, `other` |
| `priority` | TEXT | `P1` (life-threatening), `P2` (urgent), `P3` (standard), `P4` (non-urgent) |
| `summary` | TEXT | Free-text summary |
| `created_at` | TEXT | ISO 8601 |
| `updated_at` | TEXT | ISO 8601 |
| `resolved_at` | TEXT | ISO 8601 or NULL |
| `s3_audio_prefix` | TEXT | S3 key prefix for audio chunks |
| `s3_transcript_key` | TEXT | S3 key for transcript JSON |

### `transcription_turns`

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID |
| `incident_id` | TEXT FK | References `incidents.id` |
| `role` | TEXT | `caller` or `agent` |
| `text` | TEXT NOT NULL | Transcribed speech |
| `timestamp_ms` | INTEGER | Milliseconds since call start |
| `created_at` | TEXT | ISO 8601 |

### `units`

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID |
| `unit_code` | TEXT UNIQUE | e.g. `EMS-1`, `FD-3` |
| `type` | TEXT | `fire`, `ems`, `police`, `hazmat`, `rescue` |
| `status` | TEXT | `available`, `dispatched`, `on_scene`, `returning` |
| `current_incident_id` | TEXT FK | References `incidents.id`, or NULL |
| `created_at` | TEXT | ISO 8601 |
| `updated_at` | TEXT | ISO 8601 |

### `dispatches`

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID |
| `incident_id` | TEXT FK | References `incidents.id` |
| `unit_id` | TEXT FK | References `units.id` |
| `dispatched_at` | TEXT | ISO 8601 |
| `arrived_at` | TEXT | ISO 8601 or NULL |
| `cleared_at` | TEXT | ISO 8601 or NULL |

### `schema_migrations`

| Column | Type | Description |
|---|---|---|
| `version` | TEXT PK | e.g. `001_initial` |
| `applied_at` | TEXT | ISO 8601 |
