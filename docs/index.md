# RapidResponse.ai Documentation

RapidResponse.ai is a Bun-based AI-assisted 911 dispatch platform using AWS Bedrock (Nova Sonic + Nova Lite), libSQL, LanceDB, and a React dashboard.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [Seeding Sample Data](#seeding-sample-data)
- [Protocol Ingestion](#protocol-ingestion)
- [Testing](#testing)
- [Further Reading](#further-reading)

---

## Quick Start

```bash
git clone https://github.com/pratheek-c/RapidResponse.git
cd RapidResponse
bun install
cp .env.example .env
bun run --filter backend db:migrate
```

Run apps:

```bash
bun run dev:backend
bun run dev:frontend
```

Dashboard: `http://localhost:5173/dashboard`

---

## Project Structure

```
rapidresponse/
├── README.md
├── docs/
│   ├── index.md
│   ├── architecture.md
│   ├── api-reference.md
│   └── frontend.md
├── backend/
│   ├── package.json
│   ├── scripts/
│   │   ├── migrate.ts
│   │   ├── seed.ts
│   │   ├── seedDemo.ts
│   │   └── ingest.ts
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
│       │   ├── sseService.ts
│       │   ├── storageService.ts
│       │   ├── ragService.ts
│       │   └── transcriptionService.ts
│       ├── routes/
│       │   ├── incidents.ts
│       │   ├── units.ts
│       │   ├── dispatch.ts
│       │   ├── reportRoute.ts
│       │   ├── protocols.ts
│       │   ├── recordings.ts
│       │   └── mockRoute.ts
│       ├── ws/callHandler.ts
        │       └── db/
│           ├── libsql.ts
│           ├── lancedb.ts
│           └── migrations/
│               ├── 001_initial.sql
│               ├── 002_add_indexes.sql
│               ├── 003_add_caller_address.sql
│               ├── 004_dispatch_tables.sql
│               ├── 005_fix_units_fk.sql
│               ├── 006_fix_transcription_dispatches_fk.sql
│               ├── 007_add_cad_number.sql
│               ├── 008_add_covert_distress.sql
│               └── 009_roles.sql
└── frontend/
    └── src/
        ├── types/index.ts
        ├── context/
        │   └── SessionContext.tsx
        ├── hooks/
        │   ├── useAuth.ts
        │   ├── useCallerInfo.ts
        │   ├── useCallSocket.ts
        │   ├── useDispatcherLocation.ts
        │   ├── useIncidents.ts
        │   ├── useSSE.ts
        │   └── useUnits.ts
        ├── components/
        │   ├── common/
        │   │   ├── AssignmentAlertBanner.tsx
        │   │   ├── BackupAlertBanner.tsx
        │   │   ├── DeptIcon.tsx
        │   │   ├── Header.tsx
        │   │   ├── LiveIndicator.tsx
        │   │   ├── SeverityBadge.tsx
        │   │   ├── StatusBadge.tsx
        │   │   └── TimeAgo.tsx
        │   ├── dispatch/
        │   │   ├── ActionButtons.tsx
        │   │   ├── BackupModal.tsx
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
        │       └── LiveTranscript.tsx
        └── pages/
            ├── CallerView.tsx
            ├── DashboardView.tsx
            ├── DispatcherDashboard.tsx
            └── LoginPage.tsx
```

---

## Environment Variables

See `.env.example` for canonical values.

Core variables include:
- `AWS_REGION`
- `BEDROCK_NOVA_SONIC_MODEL_ID`
- `BEDROCK_NOVA_LITE_MODEL_ID`
- `BEDROCK_TITAN_EMBED_MODEL_ID`
- `LIBSQL_URL`
- `S3_BUCKET_NAME`
- `LANCEDB_PATH`
- `PORT`
- `FRONTEND_URL`

---

## Database Setup

Run migrations:

```bash
bun run --filter backend db:migrate
```

Migration order currently:

1. `001_initial`
2. `002_add_indexes`
3. `003_add_caller_address`
4. `004_dispatch_tables`
5. `005_fix_units_fk`
6. `006_fix_transcription_dispatches_fk`
7. `007_add_cad_number`
8. `008_add_covert_distress`
9. `009_roles`

Schema overview:

| Table | Purpose |
|---|---|
| `incidents` | Core incident record + dispatch extension columns (`cad_number`, `covert_distress` added) |
| `transcription_turns` | Per-turn transcript storage |
| `units` | Unit fleet state |
| `dispatches` | Legacy dispatch lifecycle rows |
| `dispatch_actions` | Dispatcher action audit log |
| `incident_units` | Units assigned to incidents |
| `dispatch_questions` | Dispatcher Q&A history |
| `backup_requests` | Unit officer backup requests with alerted/responded unit lists |
| `active_sessions` | Role-based login sessions (dispatcher or unit_officer) |
| `schema_migrations` | Migration tracking |

---

## Seeding Sample Data

Two seed options exist in backend scripts:

```bash
bun run --filter backend seed
bun run --filter backend seed:demo
```

Recommended for dashboard demos:

```bash
bun run --filter backend seed:demo
```

`seed:demo` includes realistic linked data across incidents, units, dispatches, transcript turns, incident_units, dispatch_actions, and dispatch_questions.

---

## Protocol Ingestion

Place docs in `backend/protocols/` and run:

```bash
bun run --filter backend ingest:protocols
```

This chunks content, embeds via Titan v2, and stores vectors in LanceDB `protocols`.

---

## Testing

```bash
bun test
```

Backend-only:

```bash
bun test --filter backend
```

Current status: **92 tests, 0 failures** across 5 suites:

| Suite | Notes |
|---|---|
| `smoke.test.ts` | 47-test HTTP + WebSocket + SSE integration smoke suite |
| `db.migrations.test.ts` | Migration sequencing and schema verification |
| `novaAgent.test.ts` | Nova Sonic session and tool-call mocking |
| `routes.test.ts` | REST route contract tests |
| `services.test.ts` | Service layer unit tests |

---

## Further Reading

- `docs/architecture.md` - system architecture and storage model
- `docs/api-reference.md` - REST, SSE, and WebSocket contracts
- `docs/frontend.md` - frontend hooks/components and event handling
