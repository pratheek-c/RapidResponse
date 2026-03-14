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
│                                                                            │
│  GET  /incidents[/:id]     GET  /recordings/...                            │
│  PATCH /incidents/:id      GET  /protocols/search                          │
│  GET  /units[/:id]         GET  /events (SSE)                              │
│  POST/PATCH /units/:id     GET  /health                                    │
│  POST  /dispatch                                                           │
│  GET   /dispatch/:id                                                       │
│  PATCH /dispatch/:id/arrive|clear                                          │
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
| Frontend routing | React Router v6 | Client-side routing for /dashboard and /call |

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
1.  Caller opens /call in browser
2.  Browser requests mic permission
3.  Browser opens WebSocket to ws://backend/call
4.  Browser sends: { type: "call_start", caller_id: "...", location: "..." }
5.  callHandler.ts creates incident in libSQL (status: "active")
6.  callHandler.ts fires SSE: incident_created → dashboard
7.  callHandler.ts opens Nova Sonic bidirectional stream (novaAgent.ts)
8.  Server sends: { type: "call_accepted", incident_id: "..." }

During call:
9.  Browser captures PCM audio via MediaRecorder (32ms chunks)
10. Browser sends: { type: "audio_chunk", data: "<base64 PCM 16kHz>" }
11. callHandler forwards audio to novaAgent.sendAudio()
12. novaAgent sends audioInput events to Bedrock HTTP/2 stream
13. Bedrock responds with audioOutput → base64 PCM 24kHz
14. novaAgent calls callbacks.onAudioOutput(base64Pcm)
15. callHandler sends: { type: "audio_response", data: "..." } to browser
16. Browser decodes PCM and plays through AudioContext (24kHz)

Transcription:
17. Bedrock sends textOutput events with transcribed turns
18. novaAgent calls callbacks.onTranscript(role, text)
19. callHandler saves turn to libSQL (fire-and-forget)
20. callHandler sends: { type: "transcript_update", role, text } to browser

Barge-in:
21. If caller interrupts agent: textOutput has { interrupted: true }
22. novaAgent sends "__FLUSH__" sentinel to callbacks.onAudioOutput
23. Frontend flushes pending audio queue

Incident classification:
24. Nova Sonic fires classify_incident tool when it has enough info
25. novaAgent.executeTool() calls incidentService.classifyIncident()
26. incidentService updates libSQL, fires SSE: incident_classified
27. callHandler sends: { type: "incident_classified", ... } to browser

RAG protocol lookup:
28. Nova Sonic fires get_protocol tool
29. novaAgent.executeTool() calls ragService.searchProtocols(query, 3)
30. ragService embeds query with Titan Embeddings v2
31. ragService queries LanceDB protocols collection (cosine similarity)
32. Top-3 chunks returned as context injected into Nova Sonic next turn

Unit dispatch:
33. Nova Sonic fires dispatch_unit tool
34. novaAgent.executeTool() calls dispatchService.dispatchUnit()
35. dispatchService finds first available unit of requested type
36. dispatchService creates dispatch record, updates unit + incident status
37. dispatchService fires SSE: unit_dispatched → dashboard

Call end:
38. Caller sends { type: "call_end" } OR Nova Sonic ends session
39. callHandler calls session.close()
40. callHandler exports transcript JSON from libSQL
41. callHandler uploads transcript JSON to S3
42. callHandler updates incident with s3_transcript_key
43. callHandler sends: { type: "call_ended", incident_id } to browser
44. SSE: call_ended broadcast to dashboard
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

---

## Nova Sonic Agent

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
| `caller_location` | TEXT NOT NULL | Reported location |
| `status` | TEXT | `active`, `dispatched`, `resolved`, `cancelled` |
| `type` | TEXT | `fire`, `medical`, `police`, `traffic`, `hazmat`, `search_rescue`, `other` |
| `priority` | TEXT | `P1`, `P2`, `P3`, `P4` |
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
