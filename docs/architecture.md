# Architecture

This document describes the system design, call flow, service boundaries, and storage schema for RapidResponse.ai.

---

## Table of Contents

- [High-Level Overview](#high-level-overview)
- [Technology Choices](#technology-choices)
- [Data Storage Boundaries](#data-storage-boundaries)
- [Full Call Lifecycle](#full-call-lifecycle)
- [Backend Service Layer](#backend-service-layer)
- [AI Agents](#ai-agents)
- [SSE Event Bus](#sse-event-bus)
- [Database Schema](#database-schema)

---

## High-Level Overview

```
Caller Browser (/)
  - Mic capture (PCM 16kHz mono)
  - WebSocket /call
           |
           v
Bun Backend (server.ts)
  - WS: /call  -> callHandler.ts
  - SSE: /events
  - REST: /incidents, /units, /dispatch, /report, /protocols, /recordings, /mock
           |
           +--> novaAgent.ts (Bedrock Nova Sonic 2 bidirectional stream)
           |      - tool calls: classify_incident, get_protocol, dispatch_unit
           |      - session registry for dispatcher injection
           |
           +--> reportAgent.ts (Bedrock Nova Lite)
           |      - periodic AI incident report
           |      - close summary generation
           |
           +--> dispatchBridgeAgent.ts (Bedrock Nova Lite)
           |      - refines dispatcher questions
           |      - extracts answers from transcript when call is inactive
           |
           +--> triageAgent.ts (local rules)
           |      - escalation suggestion based on transcript + extraction
           |
           +--> extractionService.ts (Bedrock Nova Lite)
                  - debounced live extraction updates

Persistence
  - libSQL: incidents, transcription_turns, units, dispatches,
            dispatch_actions, incident_units, dispatch_questions,
            backup_requests, active_sessions
  - LanceDB: protocols, incidents_history, locations
  - S3: recordings/{incident_id}/audio_*.webm + transcript.json
```

---

## Technology Choices

| Concern | Technology | Why |
|---|---|---|
| Runtime | Bun | Native TypeScript execution, built-in HTTP/WS, fast startup |
| Voice agent | AWS Bedrock Nova Sonic 2 | Real-time bidirectional audio with tool use |
| Extraction/report bridge | AWS Bedrock Nova Lite | Lower-cost, non-streaming text model for extraction/QA/report tasks |
| Embeddings | Titan Embeddings v2 | 1024-dim vectors for RAG |
| Vector store | LanceDB | Embedded vector DB with cosine search |
| Relational store | libSQL | Embedded SQL for transactional incident/dispatch data |
| Binary storage | AWS S3 | Durable storage for audio + transcript exports |
| Frontend | React 18 + Vite + TypeScript | Fast dashboard iteration with strict typing |

---

## Data Storage Boundaries

| Store | Used for | Never used for |
|---|---|---|
| libSQL | Structured operational data (incidents, units, dispatch actions, Q&A) | Embeddings, raw audio blobs |
| LanceDB | Vector search collections for RAG/proximity | Relational transactional records |
| S3 | Audio chunks and transcript file exports | Mutable relational records |

Rules followed in code:
- IDs are UUIDs (`crypto.randomUUID()`).
- Timestamps are stored as ISO8601 text columns.
- SQL writes are parameterized.
- Schema changes happen via new numbered migrations only.

---

## Full Call Lifecycle

```
1. Caller opens / and clicks Call 911.
2. Frontend starts WS /call and sends call_start.
3. callHandler creates incident (status=active) in libSQL.
4. callHandler starts Nova Sonic session and registers it in novaAgent active session map.
5. Browser streams audio_chunk PCM16/16kHz -> callHandler -> novaAgent -> Bedrock stream.
6. Bedrock audio output returns PCM16/24kHz -> callHandler -> browser audio_response.
7. Bedrock text output produces turns -> saved to transcription_turns and sent as WS transcript_update.
8. callHandler pushes dashboard SSE transcript_update for every caller/AI turn.
9. After each AI turn, extractionService.maybeExtract() schedules a 3s debounced extraction.
10. extractionService emits extraction_update SSE with extracted JSON fields.
11. After each caller turn, triageAgent.evaluateEscalation() may emit escalation_suggestion SSE.
12. Nova Sonic tool calls can classify incidents, fetch protocol context, or dispatch units.
13. Report agent runs periodically and on trigger conditions to update the caller report panel.
14. Dispatchers can inject questions/dispatch notices into active Nova sessions using dispatch routes.
15. On call end: session deregistered, pending extraction canceled, transcript exported to S3,
    incident updated with transcript key, call_ended sent.
```

Important runtime details:
- Nova Sonic max session is 8 minutes; renewal timer is set at 7m30s.
- Barge-in is handled by flushing queued audio when Nova emits interruption.
- Session registry (`registerSession`, `deregisterSession`, `injectTextIntoSession`) enables live dispatcher intervention.

---

## Backend Service Layer

### `incidentService.ts`

| Function | Description |
|---|---|
| `createIncident` | Creates a new incident and emits creation events |
| `listIncidents` / `getIncident` | Incident reads with filtering |
| `updateIncident` | Patch incident fields including dispatch extension columns |
| `classifyIncident` | Updates type/priority from tool call |

### `dispatchService.ts`

| Function | Description |
|---|---|
| `dispatchUnit` | Legacy/manual unit dispatch flow |
| `markUnitArrived` / `clearUnit` | Dispatch lifecycle updates |
| `departmentToUnitType` | API-to-DB mapping: patrol->police, medical->ems |
| `buildDispatchMessage` | Creates natural-language message for live caller injection |
| `acceptIncident` | Assigns multiple units, stamps officer/accepted_at, emits `status_change` |
| `escalateIncident` | Marks incident escalated + en_route, emits `status_change` |

### `extractionService.ts`

| Function | Description |
|---|---|
| `maybeExtract` | Debounced (3s) extraction from ongoing transcript |
| `cancelExtraction` | Cancels pending extraction timer at call end |
| `getExtraction` | Retrieves latest extraction for triage decisions |

### `sseService.ts`

| Function | Description |
|---|---|
| `sseRegister` / `sseUnregister` | Manages connected EventSource clients |
| `sseBroadcast` / `sseSend` | Legacy typed event broadcaster |
| `pushSSE` | Dispatcher dashboard typed event push (`DashboardSSEEvent`) |

### `db/libsql.ts`

Expanded DB helpers now include:
- Incident dispatch-column updates (`accepted_at`, `completed_at`, `escalated`, `officer_id`, `assigned_units`, `cad_number`, `covert_distress`)
- `dbCreateDispatchAction`, `dbGetDispatchActions`
- `dbCreateIncidentUnit`, `dbListIncidentUnits`
- `dbCreateDispatchQuestion`, `dbUpdateDispatchQuestion`, `dbGetDispatchQuestions`
- `dbCreateBackupRequest`, `dbGetOpenBackupRequestForIncident`, `dbAddBackupResponder`
- `dbGetUnit`

---

## AI Agents

### `novaAgent.ts` (Nova Sonic)
- Owns bidirectional audio stream.
- Handles tool calls for classification/RAG/dispatch.
- Maintains active session map for dispatcher injection.

### `reportAgent.ts` (Nova Lite)
- Generates evolving incident report for caller and dashboard contexts.
- Exports `generateCloseSummary()` for final report save flow.

### `dispatchBridgeAgent.ts` (Nova Lite)
- `refineQuestion(question)` rewrites dispatcher prompts for natural spoken delivery.
- `extractAnswer(question, transcript)` pulls best available answer when no live call session exists.

### `triageAgent.ts` (local deterministic logic)
- `evaluateEscalation(transcript, extraction, priority, dispatchedDepartments)` returns `EscalationSuggestion | null`.
- Used after caller turns to proactively suggest additional unit types.

---

## SSE Event Bus

The dashboard consumes events from `GET /events`. Two event families coexist:

1) Legacy incident/unit stream (`SseEvent`)
- `incident_created`
- `incident_updated`
- `incident_classified`
- `unit_dispatched`
- `transcription_turn`
- `call_ended`

2) Dashboard dispatch stream (`DashboardSSEEvent`, via `pushSSE`)
- `incident_created`
- `incident_classified`
- `transcript_update`
- `extraction_update`
- `answer_update`
- `unit_dispatched`
- `status_change`
- `escalation_suggestion`
- `incident_completed`
- `transcript_annotation` — colored inline pill emitted on tool call events (classify=blue, dispatch=cyan, question=yellow, covert_distress=red)
- `assignment_suggested` — emitted by `autoAssign()` in `novaAgent.ts` targeting a specific unit
- `unit_auto_dispatched` — emitted by `autoAssign()` when Nova Sonic auto-dispatches a unit
- `backup_requested` — emitted by `POST /dispatch/backup-request`
- `backup_accepted` — emitted by `POST /dispatch/backup-respond`
- `covert_distress` — emitted when Nova Sonic sets the `covert_distress` flag on an incident
- `unit_status_change` — unit availability change notification

Payload highlights:
- `transcript_update`: `{ incident_id, role: "caller"|"ai", text, timestamp }`
- `extraction_update`: `{ incident_id, extraction }`
- `escalation_suggestion`: `{ incident_id, reason, suggested_units }`
- `status_change`: `{ incident_id, status, unit_id? }`
- `incident_completed`: `{ incident_id, summary }`

---

## Database Schema

### Migration order

1. `001_initial.sql`
2. `002_add_indexes.sql`
3. `003_add_caller_address.sql`
4. `004_dispatch_tables.sql`
5. `005_fix_units_fk.sql`
6. `006_fix_transcription_dispatches_fk.sql`
7. `007_add_cad_number.sql`
8. `008_add_covert_distress.sql`
9. `009_roles.sql`

### `incidents` (expanded)

New status domain:
- `active`, `classified`, `dispatched`, `en_route`, `on_scene`, `completed`, `resolved`, `cancelled`

Added columns (migrations 001–006):
- `accepted_at` (TEXT)
- `completed_at` (TEXT)
- `escalated` (INTEGER 0/1)
- `officer_id` (TEXT)
- `assigned_units` (TEXT JSON array)

Added columns (migrations 007–008):
- `cad_number` (TEXT) — human-readable CAD number, format `INC-YYYYMMDD-NNNN`
- `covert_distress` (INTEGER NOT NULL DEFAULT 0) — set to 1 by Nova Sonic when silent distress is detected; indexed

### New role-based tables (migration 009)

| Table | Purpose |
|---|---|
| `backup_requests` | Unit officer backup request log — fields: `id`, `incident_id`, `requesting_unit`, `requested_types` (JSON), `urgency` (`routine\|urgent\|emergency`), `message`, `alerted_units` (JSON), `responded_units` (JSON), `created_at` |
| `active_sessions` | Active role-based login sessions — fields: `id`, `user_id`, `role` (`dispatcher\|unit_officer`), `unit_id` (NULL for dispatchers), `station_id` (NULL for unit officers), `logged_in_at`, `last_heartbeat` |

### New dispatch tables (migrations 004–006)

| Table | Purpose |
|---|---|
| `dispatch_actions` | Immutable audit log for dispatcher actions (`accept`, `escalate`, `question`, `complete`, `save_report`) |
| `incident_units` | Unit assignments per incident with assignment lifecycle status |
| `dispatch_questions` | Dispatcher Q&A history including refined question and extracted answer |

### Existing core tables

| Table | Purpose |
|---|---|
| `transcription_turns` | Per-turn transcript data |
| `units` | Current unit availability + active incident link |
| `dispatches` | Legacy dispatch records and arrive/clear timestamps |
| `schema_migrations` | Applied migration history |
