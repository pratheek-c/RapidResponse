# RapidResponse.ai

> AI-powered 911 emergency dispatch — real-time voice triage, incident classification, and dispatcher coordination backed by AWS Nova Sonic, LanceDB, and libSQL.

[![Build](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/your-org/rapidresponse)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Runtime](https://img.shields.io/badge/runtime-Bun-f9f1e1)](https://bun.sh)
[![AWS](https://img.shields.io/badge/AI-AWS%20Nova%20Sonic-orange)](https://aws.amazon.com/bedrock/)

---

## Overview

RapidResponse.ai is a municipal-grade 911 emergency response platform where an AI voice agent (AWS Bedrock Nova Sonic 2) autonomously handles incoming emergency calls through a web interface. The agent triages callers, follows protocol-driven questioning via RAG, classifies incidents by type and priority, and surfaces actionable data to human dispatchers in real time.

**Key capabilities:**

- Live bidirectional voice call via WebSocket — callers speak from any browser
- AWS Nova Sonic 2 (Bedrock) handles the full caller interaction autonomously
- Real-time transcription saved per-utterance to libSQL (open-source embedded)
- Emergency protocols (MPDS-style) stored as vectors in LanceDB; queried via RAG on every call
- Incident classification: type (medical / fire / law enforcement / hazmat / other) and priority 1–5
- S2 geometry indexing in LanceDB for fast caller location proximity queries
- Raw audio recordings stored in AWS S3
- React/TypeScript dispatcher dashboard with live incident feed, unit tracker, and full call replay

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Caller (Browser)                         │
│              Web app — microphone → AudioWorklet                │
└──────────────────────────┬──────────────────────────────────────┘
                           │ WebSocket (PCM audio stream)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    RapidResponse.ai Backend                     │
│                  Bun + TypeScript monolith                      │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │               WebSocket Call Handler                    │   │
│  │  - Streams audio to AWS Bedrock Nova Sonic 2            │   │
│  │  - Receives AI audio response, streams back to caller   │   │
│  │  - Extracts transcript turns in real time               │   │
│  └────────────┬──────────────────────┬──────────────────────┘  │
│               │                      │                          │
│               ▼                      ▼                          │
│  ┌─────────────────────┐  ┌──────────────────────────────┐     │
│  │   Nova Sonic Agent  │  │      Incident Service        │     │
│  │  - System prompt    │  │  - Create/update incident    │     │
│  │  - Tool use:        │  │  - Classify type + priority  │     │
│  │    classify_incident│  │  - Assign units              │     │
│  │    get_protocol     │  │  - Push SSE to dashboard     │     │
│  │    dispatch_unit    │  └──────────────────────────────┘     │
│  └─────────────────────┘                                        │
│                                                                 │
│  ┌──────────────┐  ┌────────────────┐  ┌─────────────────┐    │
│  │   libSQL           │  │    LanceDB     │  │    AWS S3       │    │
│  │  (embedded file)   │  │  + S2 Geometry │  │  Audio storage  │    │
│  │  incidents   │  │  protocols     │  │  recordings/    │    │
│  │  transcripts │  │  incidents     │  │  {incident_id}/ │    │
│  │  units       │  │  locations     │  │  *.webm         │    │
│  │  dispatches  │  │                │  │                 │    │
│  └──────────────┘  └────────────────┘  └─────────────────┘    │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                  REST API (Express-style)                │  │
│  │  GET/POST /incidents  GET/POST /units  POST /dispatch    │  │
│  │  GET /incidents/:id/transcript   GET /protocols         │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ REST + SSE
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│               Dispatcher Dashboard (React / TS)                 │
│  - Live incident board (SSE)                                    │
│  - Call transcript panel + audio playback                       │
│  - Unit map tracker                                             │
│  - Manual dispatch controls                                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Runtime | [Bun](https://bun.sh) | Fast TypeScript runtime for backend |
| Language | TypeScript (strict) | Full stack type safety |
| Voice AI | AWS Bedrock Nova Sonic 2 | Bidirectional voice agent |
| Embeddings | AWS Bedrock Titan Embeddings v2 | Protocol + incident vectorization |
| Vector DB | [LanceDB](https://lancedb.com) (`@lancedb/lancedb`) + S2 | Protocol RAG, location proximity search |
| Relational DB | [libSQL](https://github.com/tursodatabase/libsql) (open-source, embedded file mode) | Incidents, transcriptions, units, dispatches |
| Audio Storage | AWS S3 | Raw call recordings |
| Frontend | React 18 + TypeScript + Vite | Dispatcher dashboard |
| HTTP/WS Server | Bun native `Bun.serve()` | WebSocket call handling + REST API |
| Deployment | AWS ECS (Fargate) + ALB | Containerized backend |

---

## Project Structure

```
rapidresponse/
├── package.json                    # Root — Bun workspace config
├── bunfig.toml                     # Bun configuration
├── .env.example                    # All required environment variables
├── README.md
├── AGENTS.md                       # AI agent / OpenCode context
├── .opencode/
│   └── skills/                     # OpenCode skill definitions
│       ├── ingest-protocols.md
│       ├── seed-db.md
│       ├── run-migrations.md
│       ├── build-docker.md
│       └── deploy-ecs.md
│
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                # Entry point — starts Bun server
│   │   ├── server.ts               # HTTP server, WebSocket upgrade, SSE
│   │   ├── agents/
│   │   │   └── novaAgent.ts        # Nova Sonic bidirectional stream handler
│   │   ├── services/
│   │   │   ├── transcriptionService.ts   # Save transcript turns to libSQL
│   │   │   ├── incidentService.ts        # Incident CRUD + classification
│   │   │   ├── dispatchService.ts        # Unit assignment logic
│   │   │   ├── storageService.ts         # S3 audio upload/download
│   │   │   └── ragService.ts             # LanceDB vector search
│   │   ├── db/
│   │   │   ├── libsql.ts           # libSQL client (embedded file or sqld)
│   │   │   ├── migrations/         # SQL migration files (numbered)
│   │   │   │   ├── 001_initial.sql
│   │   │   │   └── 002_add_indexes.sql
│   │   │   └── lancedb.ts          # LanceDB init, collection schemas
│   │   ├── routes/
│   │   │   ├── incidents.ts        # GET/POST /incidents
│   │   │   ├── units.ts            # GET/POST /units
│   │   │   ├── dispatch.ts         # POST /dispatch
│   │   │   ├── protocols.ts        # GET /protocols
│   │   │   └── recordings.ts       # GET /recordings/:incidentId
│   │   └── types/
│   │       └── index.ts            # Shared TypeScript types
│   ├── protocols/                  # Upload emergency protocol docs here
│   │   └── .gitkeep
│   └── scripts/
│       ├── ingest.ts               # bun run ingest:protocols
│       ├── seed.ts                 # bun run db:seed
│       └── migrate.ts              # bun run db:migrate
│
└── frontend/
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── components/
        │   ├── IncidentBoard.tsx    # Live active incidents list
        │   ├── IncidentCard.tsx     # Single incident card with priority badge
        │   ├── CallPanel.tsx        # Transcript viewer + audio playback
        │   ├── UnitTracker.tsx      # Unit status map/table
        │   ├── PriorityBadge.tsx    # Color-coded priority 1–5 badge
        │   ├── CallerView.tsx       # Browser UI for caller — mic + status
        │   └── DispatchControls.tsx # Assign unit to incident
        ├── hooks/
        │   ├── useIncidentFeed.ts   # SSE subscription to live incidents
        │   ├── useCallSession.ts    # WebSocket audio session management
        │   └── useUnits.ts          # Units polling/state
        └── types/
            └── index.ts             # Frontend TypeScript types
```

---

## Prerequisites

- [Bun](https://bun.sh) >= 1.1.0
- AWS account with Bedrock access (Nova Sonic 2 + Titan Embeddings v2 enabled in your region)
- AWS S3 bucket for recordings
- Docker (for deployment)

> **No cloud database account required.** libSQL runs as an embedded file by default (`file:./data/rapidresponse.db`). Optionally run the open-source [`sqld`](https://github.com/tursodatabase/libsql) server via Docker for networked/multi-client access.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in all values.

```bash
cp .env.example .env
```

| Variable | Service | Description |
|---|---|---|
| `AWS_REGION` | AWS | Region where Bedrock is enabled (e.g. `us-east-1`) |
| `AWS_ACCESS_KEY_ID` | AWS | IAM access key with Bedrock + S3 permissions |
| `AWS_SECRET_ACCESS_KEY` | AWS | IAM secret key |
| `BEDROCK_NOVA_SONIC_MODEL_ID` | Bedrock | Nova Sonic 2 model ID (`amazon.nova-2-sonic-v1:0`) |
| `BEDROCK_TITAN_EMBED_MODEL_ID` | Bedrock | Titan Embeddings v2 model ID |
| `LIBSQL_URL` | libSQL | `file:./data/rapidresponse.db` (default) or `http://localhost:8080` (sqld) |
| `LIBSQL_AUTH_TOKEN` | libSQL | Optional — only set when using sqld with auth enabled |
| `S3_BUCKET_NAME` | S3 | Bucket name for audio recordings |
| `S3_RECORDINGS_PREFIX` | S3 | Object key prefix (default: `recordings/`) |
| `LANCEDB_PATH` | LanceDB | Local path for LanceDB data dir (default: `./data/lancedb`) |
| `PORT` | Server | HTTP server port (default: `3000`) |
| `FRONTEND_URL` | Server | Allowed CORS origin for the dashboard |
| `DISPATCH_CITY` | Nova Sonic | City name injected into the AI dispatcher system prompt |
| `DISPATCH_DEPT` | Nova Sonic | Department name injected into the AI dispatcher system prompt |

---

## Setup & Installation

### 1. Install dependencies

```bash
bun install
```

This installs dependencies for the root workspace, `backend/`, and `frontend/` simultaneously.

### 2. Initialize the database

```bash
bun run db:migrate
```

Runs all SQL migrations in `backend/src/db/migrations/` in order. By default libSQL runs as an embedded file at `./data/rapidresponse.db` — no server setup required.

To use the open-source `sqld` server instead, start it via Docker and set `LIBSQL_URL`:

```bash
docker run -p 8080:8080 ghcr.io/tursodatabase/libsql-server
# Then set LIBSQL_URL=http://localhost:8080 in .env
```

### 3. Initialize LanceDB collections

LanceDB collections are created automatically on first startup. No manual setup required.

### 4. Ingest emergency protocol documents

Place your protocol documents (PDF, TXT, or Markdown) in `backend/protocols/`, then run:

```bash
bun run ingest:protocols
```

This chunks the documents, generates embeddings via Bedrock Titan, and upserts them into the LanceDB `protocols` collection.

### 5. (Optional) Seed with test data

```bash
bun run db:seed
```

Populates libSQL with sample incidents, units, and dispatch records for local development.

---

## Running Locally

Run backend and frontend concurrently:

```bash
bun run dev
```

Or run them separately:

```bash
# Backend only
bun run dev:backend

# Frontend only
bun run dev:frontend
```

| Service | URL |
|---|---|
| Backend HTTP + WebSocket | `http://localhost:3000` |
| Dispatcher Dashboard | `http://localhost:5173` |
| Caller Web App | `http://localhost:5173/call` |

---

## Scripts Reference

All scripts are run from the project root.

| Script | Description |
|---|---|
| `bun run dev` | Start backend + frontend in watch mode |
| `bun run dev:backend` | Start backend only in watch mode |
| `bun run dev:frontend` | Start frontend (Vite dev server) |
| `bun run build` | Build both backend and frontend for production |
| `bun run build:backend` | Compile backend TypeScript |
| `bun run build:frontend` | Vite production build |
| `bun run db:migrate` | Run all pending SQL migrations |
| `bun run db:status` | Show migration status |
| `bun run db:seed` | Seed database with development test data |
| `bun run ingest:protocols` | Ingest protocol docs into LanceDB |
| `bun run test` | Run all tests with Bun test runner |
| `bun run test:backend` | Run backend tests only |
| `bun run lint` | Run TypeScript compiler check (no emit) |

---

## API Reference

### WebSocket — Call Session

**Endpoint:** `ws://host/call`

The caller's browser opens a WebSocket connection. Audio is streamed as binary frames (PCM 16-bit, 16kHz, mono). The server streams AI audio response back as binary frames in the same format.

| Direction | Format | Description |
|---|---|---|
| Client → Server | Binary (PCM) | Microphone audio chunk |
| Client → Server | JSON text | `{ type: "call_start", location: "...", callerId: "..." }` |
| Client → Server | JSON text | `{ type: "call_end" }` |
| Server → Client | Binary (PCM) | Nova Sonic audio response |
| Server → Client | JSON text | `{ type: "transcript", speaker: "caller\|ai", text: "...", timestamp: "..." }` |
| Server → Client | JSON text | `{ type: "incident_created", incidentId: "...", priority: 1-5, classification: "..." }` |

### REST API

#### Incidents

| Method | Path | Description |
|---|---|---|
| `GET` | `/incidents` | List all incidents (query: `?status=active`) |
| `GET` | `/incidents/:id` | Get single incident with full details |
| `GET` | `/incidents/:id/transcript` | Get full transcript for an incident |
| `POST` | `/incidents` | Create incident manually |
| `PATCH` | `/incidents/:id` | Update incident status or priority |

#### Units

| Method | Path | Description |
|---|---|---|
| `GET` | `/units` | List all units with current status |
| `POST` | `/units` | Register a new unit |
| `PATCH` | `/units/:id` | Update unit status or location |

#### Dispatch

| Method | Path | Description |
|---|---|---|
| `POST` | `/dispatch` | Assign unit to incident `{ incidentId, unitId }` |
| `PATCH` | `/dispatch/:id/arrive` | Mark unit as arrived on scene |
| `PATCH` | `/dispatch/:id/clear` | Clear unit from incident |

#### Protocols

| Method | Path | Description |
|---|---|---|
| `GET` | `/protocols` | List all ingested protocol documents |
| `GET` | `/protocols/search?q=...` | Vector search protocols by query |

#### Recordings

| Method | Path | Description |
|---|---|---|
| `GET` | `/recordings/:incidentId` | List S3 audio files for an incident |
| `GET` | `/recordings/:incidentId/url` | Get presigned S3 URL for playback |

### Server-Sent Events

**Endpoint:** `GET /events`

Dispatcher dashboard subscribes to this SSE stream for live updates.

| Event | Payload |
|---|---|
| `incident_created` | Full incident object |
| `incident_updated` | `{ id, changes }` |
| `unit_updated` | Full unit object |
| `transcript_turn` | `{ incidentId, speaker, text, timestamp }` |

---

## Data Model

### libSQL — Structured Data (open-source embedded)

```sql
-- Active and historical incidents
CREATE TABLE incidents (
  id           TEXT PRIMARY KEY,
  caller_id    TEXT,
  type         TEXT NOT NULL,         -- medical | fire | law | hazmat | other
  priority     INTEGER NOT NULL,      -- 1 (critical) to 5 (low)
  status       TEXT NOT NULL,         -- active | dispatched | resolved | closed
  location     TEXT,                  -- Free-text address extracted by AI
  lat          REAL,
  lng          REAL,
  s2_cell_id   TEXT,                  -- S2 cell token for LanceDB proximity
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- Per-utterance transcript log
CREATE TABLE transcriptions (
  id           TEXT PRIMARY KEY,
  incident_id  TEXT NOT NULL REFERENCES incidents(id),
  speaker      TEXT NOT NULL,         -- caller | ai
  text         TEXT NOT NULL,
  timestamp    TEXT NOT NULL
);

-- Emergency response units
CREATE TABLE units (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,         -- e.g. "Engine 7", "Unit 42"
  type         TEXT NOT NULL,         -- police | fire | ems | hazmat
  status       TEXT NOT NULL,         -- available | dispatched | on_scene | off_duty
  lat          REAL,
  lng          REAL,
  updated_at   TEXT NOT NULL
);

-- Dispatch assignments
CREATE TABLE dispatches (
  id           TEXT PRIMARY KEY,
  incident_id  TEXT NOT NULL REFERENCES incidents(id),
  unit_id      TEXT NOT NULL REFERENCES units(id),
  dispatched_at TEXT NOT NULL,
  arrived_at   TEXT,
  cleared_at   TEXT
);
```

### LanceDB — Vector Collections

| Collection | Schema | Purpose |
|---|---|---|
| `protocols` | `id, source_file, section, chunk_text, embedding[1024], priority_keywords, s2_cell_token` | Emergency protocol RAG |
| `incidents_history` | `id, summary, type, priority, embedding[1024], s2_cell_token` | Past incident pattern matching |
| `locations` | `id, address, lat, lng, s2_cell_token, embedding[1024]` | Geospatial proximity search |

### S3 — Object Layout

```
s3://{S3_BUCKET_NAME}/
└── recordings/
    └── {incident_id}/
        ├── audio_{timestamp}.webm   # Raw caller audio chunk
        └── transcript.json          # Final transcript export
```

---

## Deployment

### Prerequisites

- Docker installed and authenticated to AWS ECR
- AWS CLI configured with deployment credentials
- ECS cluster, task definition, and service already created
- Environment variables stored in AWS Secrets Manager or ECS task definition

### Steps

1. **Build and push Docker image:**
   ```bash
   bun run docker:build
   bun run docker:push
   ```

2. **Register new ECS task definition revision** (update image URI in task def JSON, then):
   ```bash
   aws ecs register-task-definition --cli-input-json file://infra/task-definition.json
   ```

3. **Force new ECS deployment:**
   ```bash
   aws ecs update-service \
     --cluster rapidresponse-cluster \
     --service rapidresponse-backend \
     --force-new-deployment
   ```

4. **Monitor deployment:**
   ```bash
   aws ecs wait services-stable \
     --cluster rapidresponse-cluster \
     --services rapidresponse-backend
   ```

### Required IAM Permissions

The ECS task role must have:

```json
{
  "bedrock:InvokeModel",
  "bedrock:InvokeModelWithResponseStream",
  "s3:PutObject",
  "s3:GetObject",
  "s3:ListBucket"
}
```

---

## Contributing

### Branch Naming

```
feature/short-description
fix/short-description
chore/short-description
```

### Commit Style

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add unit proximity dispatch logic
fix: handle Nova Sonic stream disconnect gracefully
chore: update protocol ingestion chunk size
```

### PR Checklist

- [ ] `bun run lint` passes (no TypeScript errors)
- [ ] `bun run test` passes
- [ ] New env vars added to `.env.example`
- [ ] New DB columns have a migration file
- [ ] New protocol fields documented in AGENTS.md

---

## License

MIT — see [LICENSE](LICENSE)
