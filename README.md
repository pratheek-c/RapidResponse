# RapidResponse.ai

AI-powered 911 dispatch platform with live voice triage, dispatch workflows, and real-time dashboard updates.

---

## Overview

RapidResponse.ai combines:
- AWS Bedrock Nova Sonic 2 for real-time call handling
- AWS Bedrock Nova Lite for report/extraction/dispatch question bridge tasks
- libSQL for transactional dispatch data
- LanceDB for protocol RAG vectors
- S3 for audio and transcript exports
- React + TypeScript dashboard for dispatcher operations

---

## Runtime and Tooling

This repo uses Bun workspaces.

Use Bun commands only:

```bash
bun install
bun run dev:backend
bun run dev:frontend
```

---

## Project Structure

```
rapidresponse/
├── package.json
├── README.md
├── docs/
│   ├── architecture.md
│   ├── api-reference.md
│   ├── frontend.md
│   └── index.md
├── backend/
│   ├── package.json
│   ├── data/mock/dispatchers.json
│   ├── scripts/
│   │   ├── migrate.ts
│   │   ├── ingest.ts
│   │   ├── seed.ts
│   │   └── seedDemo.ts
│   └── src/
│       ├── agents/
│       │   ├── novaAgent.ts
│       │   ├── reportAgent.ts
│       │   ├── dispatchBridgeAgent.ts
│       │   └── triageAgent.ts
│       ├── services/
│       │   ├── incidentService.ts
│       │   ├── dispatchService.ts
│       │   ├── extractionService.ts
│       │   ├── transcriptionService.ts
│       │   ├── storageService.ts
│       │   ├── ragService.ts
│       │   └── sseService.ts
│       ├── routes/
│       │   ├── incidents.ts
│       │   ├── units.ts
│       │   ├── dispatch.ts
│       │   ├── reportRoute.ts
│       │   ├── protocols.ts
│       │   ├── recordings.ts
│       │   └── mockRoute.ts
│       ├── ws/callHandler.ts
│       ├── db/
│       │   ├── libsql.ts
│       │   ├── lancedb.ts
│       │   └── migrations/
│       │       ├── 001_initial.sql
│       │       ├── 002_add_indexes.sql
│       │       ├── 003_add_caller_address.sql
│       │       ├── 004_dispatch_tables.sql
│       │       ├── 005_fix_units_fk.sql
│       │       └── 006_fix_transcription_dispatches_fk.sql
│       └── types/index.ts
└── frontend/
    └── src/
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

## Setup

```bash
cp .env.example .env
bun install
bun run --filter backend db:migrate
```

Run:

```bash
bun run dev:backend
bun run dev:frontend
```

URLs:
- Backend: `http://localhost:3000`
- Dashboard: `http://localhost:5173/dashboard`
- Caller UI: `http://localhost:5173/`

---

## Data Model

### libSQL tables

| Table | Purpose |
|---|---|
| `incidents` | Core incident row with dispatch extension columns (`accepted_at`, `completed_at`, `escalated`, `officer_id`, `assigned_units`) |
| `transcription_turns` | Per-turn transcript entries |
| `units` | Unit roster and status |
| `dispatches` | Legacy unit dispatch records |
| `dispatch_actions` | Dispatcher action audit log |
| `incident_units` | Unit assignment lifecycle per incident |
| `dispatch_questions` | Dispatcher question/refined question/answer history |
| `schema_migrations` | Migration tracking |

### Incident statuses

`active | classified | dispatched | en_route | on_scene | completed | resolved | cancelled`

### Department mapping at API boundary

- `patrol` <-> `police`
- `medical` <-> `ems`
- `fire` <-> `fire`
- `hazmat` <-> `hazmat`

---

## REST API Quick Reference

Core endpoints:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/incidents` | List incidents |
| `GET` | `/incidents/resolved` | Resolved + completed feed |
| `GET` | `/incidents/:id` | Incident details |
| `PATCH` | `/incidents/:id` | Incident updates |
| `GET` | `/incidents/:id/transcript` | Transcript turns |
| `GET` | `/incidents/:id/actions` | Dispatch action log |
| `GET` | `/incidents/:id/questions` | Dispatch Q&A log |
| `GET` | `/incidents/:id/units` | Assigned units |
| `GET` | `/units` | Unit list |
| `POST` | `/units` | Create unit |
| `PATCH` | `/units/:id` | Update unit status |
| `GET` | `/units/mock` | Mock units with ETA/distance |
| `POST` | `/dispatch` | Legacy manual dispatch |
| `GET` | `/dispatch/:incident_id` | Legacy dispatch list |
| `PATCH` | `/dispatch/:dispatch_id/arrive` | Mark arrived |
| `PATCH` | `/dispatch/:dispatch_id/clear` | Clear unit |
| `POST` | `/dispatch/accept` | Accept incident + assign units |
| `POST` | `/dispatch/question` | Ask caller via AI bridge |
| `POST` | `/dispatch/escalate` | Escalate incident |
| `POST` | `/dispatch/complete` | Complete incident |
| `POST` | `/dispatch/save-report` | Save/generate final close summary |
| `GET` | `/protocols/search` | RAG search |
| `GET` | `/recordings/:incident_id/audio` | Audio prefix |
| `GET` | `/recordings/:incident_id/playback` | Presigned audio URL |
| `GET` | `/recordings/:incident_id/transcript` | Presigned transcript URL |
| `GET` | `/report/:incident_id` | AI report |
| `GET` | `/events` | SSE stream |
| `GET` | `/health` | Health check |

For full contracts and payloads see `docs/api-reference.md`.

---

## Scripts

### Root scripts

| Script | Command |
|---|---|
| `dev:backend` | `bun run --filter backend dev` |
| `dev:frontend` | `bun run --filter frontend dev` |
| `build:backend` | `bun run --filter backend build` |
| `build:frontend` | `bun run --filter frontend build` |
| `test` | `bun test` |
| `test:backend` | `bun test --filter backend` |

### Backend scripts

| Script | Purpose |
|---|---|
| `db:migrate` | Apply SQL migrations |
| `ingest:protocols` | Ingest protocol docs to LanceDB |
| `seed` | Basic dev seed |
| `seed:demo` | Demo seed with incidents, actions, Q&A, and assignments |

---

## Documentation

- `docs/index.md`
- `docs/architecture.md`
- `docs/api-reference.md`
- `docs/frontend.md`

---

## License

MIT
