# RapidResponse.ai — Documentation

**RapidResponse.ai** is a municipal-grade AI-powered 911 emergency dispatch platform. An AI voice agent (AWS Bedrock Nova Sonic 2) autonomously handles incoming emergency calls from a browser, triages callers using RAG-backed emergency protocols, classifies incidents, and surfaces live data to human dispatchers via a React dashboard.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Environment Variables](#environment-variables)
- [Running the Application](#running-the-application)
- [Database Setup](#database-setup)
- [Seeding Sample Data](#seeding-sample-data)
- [Ingesting Protocol Documents](#ingesting-protocol-documents)
- [Running Tests](#running-tests)
- [Further Reading](#further-reading)

---

## Getting Started

### Prerequisites

| Requirement | Version |
|---|---|
| [Bun](https://bun.sh) | >= 1.1 |
| AWS account | IAM credentials with Bedrock + S3 access |
| AWS Bedrock model access | Nova Sonic 2, Titan Embeddings v2 (must be enabled in your AWS region) |

> **Important:** This project uses **Bun** as the JavaScript/TypeScript runtime. Do not use `npm`, `npx`, `yarn`, `pnpm`, `ts-node`, or `tsx` for any operation.

### 1. Clone and install

```bash
git clone https://github.com/pratheek-c/RapidResponse.git
cd RapidResponse
bun install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in every value. See [Environment Variables](#environment-variables) for the full reference.

### 3. Run database migrations

```bash
bun run db:migrate
```

This applies all numbered SQL migrations in `backend/src/db/migrations/` to the libSQL database file at `LIBSQL_URL` (defaults to `./data/rapidresponse.db`).

### 4. (Optional) Seed sample data

```bash
bun run seed
```

Inserts 12 sample units and 4 sample incidents so the dashboard has data to display immediately.

### 5. (Optional) Ingest protocol documents

Place `.txt`, `.md`, or `.pdf` files in `backend/protocols/`, then:

```bash
bun run ingest:protocols
```

This chunks the documents, embeds them with Titan Embeddings v2, and stores them in LanceDB for RAG retrieval during calls.

### 6. Start the backend

```bash
bun run dev:backend
```

The server starts on port `3000` by default (configurable via `PORT`).

### 7. Start the frontend

```bash
bun run dev:frontend
```

The Vite dev server starts on `http://localhost:5173`.

Open `http://localhost:5173/dashboard` for the dispatcher dashboard, or `http://localhost:5173/` to simulate a 911 call.

---

## Project Structure

```
rapidresponse/
├── package.json              # Bun workspace root (workspaces: backend, frontend)
├── bunfig.toml               # Bun config
├── .env.example              # Environment variable template
├── .gitignore
├── docs/                     # This documentation
├── backend/
│   ├── package.json          # Backend dependencies
│   ├── tsconfig.json
│   ├── data/                 # Runtime data (gitignored)
│   │   ├── rapidresponse.db  # libSQL embedded database
│   │   └── lancedb/          # LanceDB vector store
│   ├── protocols/            # Place .txt/.md/.pdf protocol docs here
│   ├── scripts/
│   │   ├── migrate.ts        # DB migration runner
│   │   ├── seed.ts           # Sample data seed
│   │   └── ingest.ts         # Protocol document ingestion
│   └── src/
│       ├── index.ts          # Server entry point
│       ├── server.ts         # Bun.serve() HTTP + WebSocket server
│       ├── config/
│       │   └── env.ts        # Validated environment config
│       ├── types/
│       │   └── index.ts      # All shared TypeScript types
│       ├── db/
│       │   ├── libsql.ts     # libSQL client + typed CRUD helpers
│       │   ├── lancedb.ts    # LanceDB connect + Arrow schemas
│       │   └── migrations/   # Numbered SQL migration files
│       ├── agents/
│   │   ├── novaAgent.ts  # Nova Sonic bidirectional stream agent
│   │   └── reportAgent.ts# Nova Lite report generation (every 30s)
│       ├── services/
│       │   ├── sseService.ts
│       │   ├── storageService.ts
│       │   ├── ragService.ts
│       │   ├── incidentService.ts
│       │   ├── transcriptionService.ts
│       │   └── dispatchService.ts
│       ├── routes/
│   │   ├── incidents.ts
│   │   ├── units.ts
│   │   ├── dispatch.ts
│   │   ├── protocols.ts
│   │   ├── recordings.ts
│   │   ├── reportRoute.ts# GET /report/:incident_id (in-memory cache)
│   │   └── mockRoute.ts  # GET /mock/dispatchers
│       ├── ws/
│       │   └── callHandler.ts
│       └── __tests__/
└── frontend/
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── App.tsx
        ├── main.tsx
        ├── types/index.ts
        ├── hooks/
        │   ├── useIncidents.ts
        │   ├── useUnits.ts
        │   ├── useCallSocket.ts
        │   └── useCallerInfo.ts    # GPS + Nominatim reverse geocode
        ├── components/
        └── pages/
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in all values. The table below describes each variable.

| Variable | Required | Default | Description |
|---|---|---|---|
| `AWS_REGION` | Yes | — | AWS region, e.g. `us-east-1` |
| `AWS_ACCESS_KEY_ID` | Yes | — | IAM access key |
| `AWS_SECRET_ACCESS_KEY` | Yes | — | IAM secret key |
| `BEDROCK_NOVA_SONIC_MODEL_ID` | Yes | — | Nova Sonic 2 model ID, e.g. `amazon.nova-2-sonic-v1:0` |
| `BEDROCK_NOVA_LITE_MODEL_ID` | Yes | — | Nova Lite model ID for report generation, e.g. `amazon.nova-lite-v1:0` |
| `BEDROCK_TITAN_EMBED_MODEL_ID` | Yes | — | Titan Embeddings v2 model ID, e.g. `amazon.titan-embed-text-v2:0` |
| `S3_BUCKET_NAME` | Yes | — | S3 bucket for audio recordings and transcripts |
| `LIBSQL_URL` | No | `file:./data/rapidresponse.db` | libSQL connection URL. Use `file:` for embedded, `http://localhost:8080` for networked sqld |
| `LIBSQL_AUTH_TOKEN` | No | — | Auth token for networked sqld only |
| `S3_RECORDINGS_PREFIX` | No | `recordings/` | S3 key prefix for audio and transcript files |
| `LANCEDB_PATH` | No | `./data/lancedb` | Local filesystem path for LanceDB data directory |
| `PORT` | No | `3000` | HTTP server port |
| `FRONTEND_URL` | No | `http://localhost:5173` | Allowed CORS origin |
| `DISPATCH_CITY` | No | `Springfield` | City name injected into the Nova Sonic system prompt |
| `DISPATCH_DEPT` | No | `Springfield Emergency Services` | Department name injected into the Nova Sonic system prompt |

### Required AWS IAM permissions

The IAM user/role must have:

```json
{
  "Effect": "Allow",
  "Action": [
    "bedrock:InvokeModel",
    "bedrock:InvokeModelWithBidirectionalStream"
  ],
  "Resource": [
    "arn:aws:bedrock:*::foundation-model/amazon.nova-2-sonic-v1:0",
    "arn:aws:bedrock:*::foundation-model/amazon.nova-lite-v1:0",
    "arn:aws:bedrock:*::foundation-model/amazon.titan-embed-text-v2:0"
  ]
}
```

Plus S3 `GetObject`, `PutObject`, and `GetObjectPresignedUrl` on the recordings bucket.

---

## Running the Application

### Development (both servers)

Run each in a separate terminal:

```bash
# Terminal 1 — backend
bun run dev:backend

# Terminal 2 — frontend
bun run dev:frontend
```

### Production build

```bash
bun run build:frontend   # outputs to frontend/dist/
```

Serve `frontend/dist/` via any static file host (nginx, S3+CloudFront, etc.), pointing its API proxy at the backend server.

### Available scripts (root)

| Script | Command | Description |
|---|---|---|
| `dev:backend` | `bun run --filter backend dev` | Start backend in watch mode |
| `dev:frontend` | `bun run --filter frontend dev` | Start Vite dev server |
| `build:frontend` | `bun run --filter frontend build` | Production build |
| `test` | `bun test` | Run all backend tests |
| `test:backend` | `bun test --filter backend` | Backend tests only |

### Available scripts (backend)

Run from the `backend/` directory or with `bun run --filter backend <script>`:

| Script | Description |
|---|---|
| `db:migrate` | Apply pending SQL migrations |
| `seed` | Populate DB with sample units and incidents |
| `ingest:protocols` | Chunk, embed and store protocol documents in LanceDB |

---

## Database Setup

The backend uses two databases that serve different purposes:

### libSQL (structured data)

- Default: embedded SQLite file at `./data/rapidresponse.db` — no server required
- Optional networked mode: run the open-source `sqld` server and set `LIBSQL_URL=http://localhost:8080`
- Schema is managed with numbered migration files in `backend/src/db/migrations/`

Run migrations:

```bash
bun run db:migrate
```

#### Schema overview

| Table | Purpose |
|---|---|
| `incidents` | Emergency incident records |
| `transcription_turns` | Per-turn call transcript |
| `units` | Emergency response units (EMS, fire, police, etc.) |
| `dispatches` | Unit-to-incident dispatch records |
| `schema_migrations` | Applied migration tracking |

### LanceDB (vector store)

- Embedded — no server required
- Data directory: `LANCEDB_PATH` (default `./data/lancedb`)
- Initialized automatically on first server startup via `initCollections()`

#### Collections

| Collection | Purpose |
|---|---|
| `protocols` | Chunked protocol documents for RAG retrieval |
| `incidents_history` | Past incident summaries for pattern matching |
| `locations` | Geocoded addresses with S2 cell IDs |

---

## Seeding Sample Data

The seed script populates the database with realistic sample data for development and demos.

```bash
bun run seed
```

This inserts:
- **12 units**: EMS-1 through EMS-3, FD-1 through FD-3, PD-1 through PD-4, HZ-1, SAR-1
- **4 incidents**: one resolved fire, one dispatched medical, one dispatched traffic accident, one active unclassified
- **5 transcription turns** on the resolved fire incident

Safe to run multiple times — existing seed units/incidents are cleared before re-insertion.

---

## Ingesting Protocol Documents

Protocol documents are used by Nova Sonic via RAG to provide callers with accurate pre-arrival instructions.

1. Place `.txt`, `.md`, or `.pdf` files in `backend/protocols/`
2. Run:

```bash
bun run ingest:protocols
```

### What the ingest script does

1. Reads each supported file from `backend/protocols/`
2. Splits text on section headers (Markdown `#`/`##` or ALL-CAPS lines) and by max 2048-character chunks with 200-character overlap
3. Embeds each chunk using AWS Bedrock Titan Embeddings v2 (1024-dimension vectors)
4. Upserts all chunks into the `protocols` LanceDB collection with fields: `id`, `source_file`, `section`, `chunk_text`, `priority_keywords`, `embedding`

### Example protocol files

```
backend/protocols/
├── cardiac-arrest.md
├── structure-fire.txt
├── hazmat-response.pdf
└── trauma-protocol.md
```

---

## Running Tests

```bash
bun test
```

The test suite covers:

| File | Tests | Coverage |
|---|---|---|
| `db.migrations.test.ts` | 17 | DB schema, CRUD helpers, migrations |
| `services.test.ts` | 11 | SSE, storage, RAG, incidents, transcription, dispatch |
| `novaAgent.test.ts` | 8 | Agent session options, tool specs, system prompt |
| `routes.test.ts` | 9 | HTTP routes for incidents, units, dispatch, protocols, recordings |

**Total: 45 tests, 0 failures**

### Test design

- Bedrock calls are mocked with `bun:mock`
- libSQL uses in-memory databases (`createClient({ url: ":memory:" })`)
- LanceDB uses a temporary directory (`/tmp/lancedb-test-{uuid}`) cleaned up after each test
- S3 is mocked — no real AWS credentials required

---

## Further Reading

- [API Reference](./api-reference.md) — all REST, WebSocket, and SSE endpoints
- [Architecture](./architecture.md) — system design, data flow, service layer
- [Frontend Guide](./frontend.md) — React pages, hooks, and components
