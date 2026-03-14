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
- Incident classification: type (medical / fire / law enforcement / hazmat / other) and priority P1–P4 (life-threatening → non-urgent)
- AI-generated incident reports via Report Agent (AWS Bedrock Nova Lite) — updated every ~30s during active calls
- S2 geometry indexing in LanceDB for fast caller location proximity queries
- Raw audio recordings stored in AWS S3
- React/TypeScript dispatcher dashboard — white/black monochrome design, live incident feed, AI report panel, unit tracker with distance + ETA, and full call replay

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
│   │   │   ├── novaAgent.ts        # Nova Sonic bidirectional stream handler
│   │   │   └── reportAgent.ts      # Report Agent — Nova Lite, periodic report gen
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
│   │   │   ├── incidents.ts        # GET/PATCH /incidents
│   │   │   ├── units.ts            # GET/POST/PATCH /units + GET /units/mock
│   │   │   ├── dispatch.ts         # POST/GET/PATCH /dispatch
│   │   │   ├── protocols.ts        # GET /protocols/search
│   │   │   ├── recordings.ts       # GET /recordings/:incidentId
│   │   │   ├── reportRoute.ts      # GET /report/:incident_id
│   │   │   └── mockRoute.ts        # GET /mock/dispatchers
│   │   └── types/
│   │       └── index.ts            # Shared TypeScript types
│   ├── data/
│   │   └── mock/
│   │       └── dispatchers.json    # Springfield IL mock dataset
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
        │   ├── Badges.tsx          # PriorityBadge, StatusBadge, TypeChip (monochrome)
        │   ├── IncidentList.tsx    # Sidebar — search, filter tabs, incident rows
        │   ├── IncidentDetail.tsx  # AI Report tab + Transcript tab
        │   └── UnitPanel.tsx       # Unit cards with distance + ETA, expandable rows
        ├── hooks/
        │   ├── useCallerInfo.ts    # GPS, reverse geocode, persistent caller UUID
        │   ├── useCallSocket.ts    # WebSocket audio session management
        │   ├── useIncidents.ts     # SSE subscription + REST for live incident list
        │   └── useUnits.ts         # Units polling/state
        └── types/
            └── index.ts            # Frontend TypeScript types
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
| `BEDROCK_NOVA_LITE_MODEL_ID` | Bedrock | Nova Lite model ID for Report Agent (`amazon.nova-lite-v1:0`) |
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
| Caller Web App | `http://localhost:5173/` |

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

See [`docs/api-reference.md`](docs/api-reference.md) for the full API documentation including all REST endpoints, WebSocket message schemas, SSE event types, and call sequence diagrams.

### Quick Reference

#### WebSocket — Call Session

**Endpoint:** `ws://host/call`

| Direction | Type | Description |
|---|---|---|
| Browser → Server | `call_start` | Start call — `{ type, caller_id, location, address }` |
| Browser → Server | `audio_chunk` | PCM audio — `{ type, data: base64 16kHz PCM }` |
| Browser → Server | `call_end` | End call cleanly |
| Server → Browser | `call_accepted` | `{ type, incident_id }` |
| Server → Browser | `audio_response` | `{ type, data: base64 24kHz PCM }` |
| Server → Browser | `transcript_update` | `{ type, role, text }` |
| Server → Browser | `incident_classified` | `{ type, incident_type, priority }` |
| Server → Browser | `report_update` | `{ type, report: IncidentReport }` |
| Server → Browser | `dispatcher_approaching` | `{ type, unit_code, eta_minutes, crew[] }` |
| Server → Browser | `call_ended` | `{ type, incident_id }` |

#### REST API (summary)

| Method | Path | Description |
|---|---|---|
| `GET` | `/incidents` | List incidents (query: `status`, `limit`, `offset`) |
| `GET` | `/incidents/:id` | Get single incident |
| `GET` | `/incidents/:id/transcript` | Get transcription turns |
| `PATCH` | `/incidents/:id` | Update incident |
| `GET` | `/units` | List units |
| `GET` | `/units/mock?lat=&lng=` | Mock units with distance + ETA |
| `POST` | `/units` | Create unit |
| `PATCH` | `/units/:id` | Update unit status |
| `POST` | `/dispatch` | Dispatch a unit to an incident |
| `GET` | `/dispatch/:incident_id` | List dispatch records |
| `PATCH` | `/dispatch/:dispatch_id/arrive` | Mark unit arrived |
| `PATCH` | `/dispatch/:dispatch_id/clear` | Clear unit |
| `GET` | `/protocols/search?q=` | RAG vector search |
| `GET` | `/recordings/:id/playback?key=` | Presigned S3 URL |
| `GET` | `/recordings/:id/transcript` | Presigned S3 transcript URL |
| `GET` | `/report/:incident_id` | AI-generated incident report |
| `GET` | `/mock/dispatchers` | Mock dispatchers, zones, hospitals |
| `GET` | `/events` | SSE stream |
| `GET` | `/health` | Health check |

---

## Data Model

See [`docs/architecture.md`](docs/architecture.md) for the complete database schema.

### libSQL — Structured Data (open-source embedded)

Key tables:

| Table | Purpose |
|---|---|
| `incidents` | Active and historical incidents (id, caller_id, caller_location, caller_address, status, type, priority, summary, timestamps, S3 keys) |
| `transcription_turns` | Per-utterance transcript log (id, incident_id, role, text, timestamp_ms) |
| `units` | Emergency response units (id, unit_code, type, status, current_incident_id) |
| `dispatches` | Dispatch assignments (id, incident_id, unit_id, dispatched_at, arrived_at, cleared_at) |

**Priority values:** `P1` (life-threatening), `P2` (urgent), `P3` (standard), `P4` (non-urgent)

**Incident types:** `fire`, `medical`, `police`, `traffic`, `hazmat`, `search_rescue`, `other`

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
  "bedrock:InvokeModelWithBidirectionalStream",
  "s3:PutObject",
  "s3:GetObject",
  "s3:ListBucket"
}
```

**Required model ARNs:**
- `arn:aws:bedrock:<region>::foundation-model/amazon.nova-2-sonic-v1:0`
- `arn:aws:bedrock:<region>::foundation-model/amazon.titan-embed-text-v2:0`
- `arn:aws:bedrock:<region>::foundation-model/amazon.nova-lite-v1:0`

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
