# RapidResponse.ai — Agent Guide

This file is the authoritative context document for any AI coding agent (OpenCode, GitHub Copilot, Cursor, etc.) working in this repository. Read this fully before making any changes.

---

## Project Identity

**RapidResponse.ai** is a municipal-grade AI-powered 911 emergency dispatch platform. An AI voice agent (AWS Bedrock Nova Sonic 2) autonomously handles incoming emergency calls from a browser, triages callers using RAG-backed emergency protocols, classifies incidents, and surfaces live data to human dispatchers via a React dashboard.

---

## Runtime — CRITICAL

**This project uses [Bun](https://bun.sh) as the JavaScript/TypeScript runtime. Not Node.js.**

| Rule | Correct | Wrong |
|---|---|---|
| Run scripts | `bun run <script>` | `npm run`, `npx`, `node` |
| Install packages | `bun install` | `npm install`, `yarn`, `pnpm` |
| Add a package | `bun add <pkg>` | `npm install <pkg>` |
| Execute a file | `bun src/index.ts` | `ts-node`, `tsx`, `node` |
| Run tests | `bun test` | `jest`, `vitest`, `mocha` |
| Run scripts directly | `bun backend/scripts/seed.ts` | `npx ts-node ...` |

**Never** suggest `npm`, `npx`, `yarn`, `pnpm`, `ts-node`, or `tsx` commands. All TypeScript runs natively via Bun.

---

## Language

- TypeScript strict mode throughout (`"strict": true` in all `tsconfig.json`)
- **No `any` types.** Use `unknown` with type guards if the shape is uncertain
- No `// @ts-ignore` or `// @ts-expect-error` without an accompanying comment explaining why
- Use `type` for object shapes, `interface` only when extension is intended
- All async functions must handle errors explicitly — no unhandled promise rejections
- Use named exports; avoid default exports except for React components

---

## Monorepo Layout

This is a **Bun workspace** monorepo.

```
rapidresponse/
├── package.json          # Root workspace — lists workspaces: ["backend", "frontend"]
├── bunfig.toml           # Bun config
├── AGENTS.md             # This file
├── README.md
├── .env                  # Local env (never commit)
├── .env.example          # Template (commit this)
├── .opencode/
│   └── skills/           # OpenCode skill definitions
├── backend/              # Bun HTTP server + WebSocket + REST API
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
└── frontend/             # React 18 + TypeScript + Vite dispatcher dashboard
    ├── package.json
    ├── tsconfig.json
    └── src/
```

When adding a dependency:
- `bun add <pkg> --filter backend` — adds to backend workspace
- `bun add <pkg> --filter frontend` — adds to frontend workspace
- `bun add <pkg>` at root — adds to root (for shared dev tooling only)

---

## Key Services

### AWS Bedrock — Nova Sonic 2 (Voice Agent)

- **File:** `backend/src/agents/novaAgent.ts`
- Nova Sonic handles the full caller interaction. It is NOT just a transcription tool — it speaks back to the caller and follows a protocol-driven conversation.
- Uses `@aws-sdk/client-bedrock-runtime` with `InvokeModelWithBidirectionalStream` (or the `ConverseStream` API once Nova Sonic supports it)
- Audio format: PCM 16-bit, 16kHz, mono
- The Nova Sonic system prompt includes: role definition, city/department context, current RAG protocol context (injected per call), tool definitions
- Nova Sonic uses **tool use** to trigger backend actions:
  - `classify_incident(type, priority)` — fires when AI has enough info to classify
  - `get_protocol(query)` — requests a RAG lookup from LanceDB
  - `dispatch_unit(incident_id, unit_type)` — requests dispatcher notification
- **Do NOT** use the OpenAI SDK or OpenAI Realtime API. AWS Bedrock SDK only.

### AWS Bedrock — Titan Embeddings v2

- **File:** `backend/src/services/ragService.ts`
- Used to embed protocol document chunks and incident summaries
- Model ID stored in `BEDROCK_TITAN_EMBED_MODEL_ID` env var
- Returns 1024-dimension float32 vectors

### LanceDB

- **File:** `backend/src/db/lancedb.ts`
- Embedded/local vector database. Data directory: `LANCEDB_PATH` env var (default `./data/lancedb`)
- Three collections:

  | Collection | Purpose |
  |---|---|
  | `protocols` | Chunked emergency protocol docs for RAG |
  | `incidents_history` | Past incident summaries for pattern matching |
  | `locations` | Geocoded addresses with S2 cell IDs for proximity search |

- S2 geometry is used for location indexing. S2 cell tokens are computed server-side using the `s2-geometry` npm package
- **LanceDB is for vectors only.** Never store structured relational data in LanceDB.

### libSQL (Turso)

- **File:** `backend/src/db/libsql.ts`
- Client: `@libsql/client`
- Connection via `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`
- All structured data lives here: incidents, transcriptions, units, dispatches
- Schema is managed via numbered SQL migration files in `backend/src/db/migrations/`
- **libSQL is for structured relational data only.** Never put embeddings or binary blobs here.

### AWS S3

- **File:** `backend/src/services/storageService.ts`
- Stores raw audio recordings uploaded from the WebSocket call handler
- Key format: `recordings/{incident_id}/audio_{unix_timestamp}.webm`
- Final transcript JSON exported to: `recordings/{incident_id}/transcript.json`
- Always use presigned URLs for playback — never expose bucket directly

---

## Data Flow — Full Call Lifecycle

```
1. Caller opens browser, navigates to /call
2. CallerView.tsx requests mic permission, opens WebSocket to ws://backend/call
3. Browser sends { type: "call_start", callerId: "...", location: "..." }
4. WebSocket handler creates a new incident record in libSQL (status: "active")
5. WebSocket handler opens bidirectional stream to Nova Sonic (Bedrock)
6. Audio frames flow: Browser → WebSocket → novaAgent.ts → Bedrock
7. Bedrock audio response flows back: Bedrock → novaAgent.ts → WebSocket → Browser
8. Each transcript turn is extracted and saved: transcriptionService.ts → libSQL
9. Audio chunks are buffered and uploaded: storageService.ts → S3
10. When Nova Sonic fires classify_incident tool:
    - incidentService.ts updates incident type + priority in libSQL
    - SSE event pushed to dispatcher dashboard
11. When Nova Sonic fires get_protocol tool:
    - ragService.ts queries LanceDB protocols collection
    - Top-3 chunks returned as context injected into next Nova Sonic turn
12. Call ends (caller hangs up or Nova Sonic determines resolution):
    - Full transcript exported to S3
    - Incident status updated to "dispatched" or "resolved"
    - Final SSE event pushed to dashboard
```

---

## Database Rules

1. **Never mix concerns.** libSQL = structured data. LanceDB = vectors. S3 = binary/audio.
2. All libSQL queries use parameterized statements. No string interpolation in SQL ever.
3. All migrations are numbered sequentially: `001_`, `002_`, etc. Never modify an existing migration — always add a new one.
4. IDs are UUIDs generated with `crypto.randomUUID()`. Never use auto-increment integers.
5. Timestamps are stored as ISO 8601 strings in libSQL (`TEXT` column).
6. All libSQL operations are wrapped in try/catch — database errors must not crash the WebSocket handler.

---

## RAG Convention

1. Protocol documents live in `backend/protocols/` as `.pdf`, `.txt`, or `.md` files
2. Ingestion script: `backend/scripts/ingest.ts`, run via `bun run ingest:protocols`
3. Chunking strategy: split by section header, max 512 tokens per chunk, 50-token overlap
4. Each chunk stored in LanceDB `protocols` collection with fields: `id`, `source_file`, `section`, `chunk_text`, `embedding`, `priority_keywords`
5. At query time, the top-3 chunks by cosine similarity are returned and injected into the Nova Sonic system prompt as a `[PROTOCOL CONTEXT]` block
6. Never hard-code protocol content in code. Always retrieve from LanceDB.

---

## Naming Conventions

### Files
- All source files: `camelCase.ts`
- React components: `PascalCase.tsx`
- Migration files: `NNN_snake_case_description.sql`
- Protocol documents: any name, stored in `backend/protocols/`

### Database
- Table names: `snake_case` plural (e.g. `incidents`, `transcriptions`)
- Column names: `snake_case` (e.g. `incident_id`, `created_at`)
- S3 keys: `recordings/{incident_id}/audio_{unix_ms}.webm`

### Routes
- REST endpoints: `kebab-case`, plural nouns (e.g. `/incidents`, `/units`, `/dispatch`)
- WebSocket endpoint: `/call`
- SSE endpoint: `/events`

### TypeScript
- Types and interfaces: `PascalCase`
- Variables and functions: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE` for true constants (env var names, model IDs)
- Enum values: `PascalCase`

---

## Do NOT

These are hard rules. Never violate them.

- **Never use `npm`, `npx`, `yarn`, `pnpm`, `ts-node`, or `tsx`**. Bun only.
- **Never use the OpenAI SDK or OpenAI Realtime API**. This project uses AWS Bedrock.
- **Never store embeddings or audio in libSQL**. LanceDB and S3 only.
- **Never store structured relational data in LanceDB**. libSQL only.
- **Never expose S3 bucket URLs directly**. Always use presigned URLs.
- **Never use `any` in TypeScript**. Use `unknown` with type guards.
- **Never interpolate variables into SQL strings**. Always use parameterized queries.
- **Never modify existing migration files**. Always create a new numbered migration.
- **Never commit `.env`**. Only `.env.example` is committed.
- **Never call Bedrock with hardcoded model IDs**. Always read from env vars.
- **Never use `console.log` for errors in production paths**. Use structured logging.

---

## Testing

- Test runner: `bun test` (built-in Bun test runner, Jest-compatible API)
- Test files: co-located with source as `*.test.ts`, or in `backend/src/__tests__/`
- Run all tests: `bun test`
- Run backend tests only: `bun test --filter backend`

### Mocking Strategy

- Bedrock calls: mock `@aws-sdk/client-bedrock-runtime` using `bun:mock`
- libSQL: use an in-memory libSQL client (`createClient({ url: ":memory:" })`)
- LanceDB: use a temp directory (`/tmp/lancedb-test-{uuid}`) and clean up after each test
- S3: mock `@aws-sdk/client-s3` — never make real S3 calls in tests
- No real AWS credentials should be required to run the test suite

---

## Environment Variables

All required env vars are documented in `.env.example`. The canonical list:

| Variable | Used In | Notes |
|---|---|---|
| `AWS_REGION` | All AWS services | e.g. `us-east-1` |
| `AWS_ACCESS_KEY_ID` | All AWS services | IAM key |
| `AWS_SECRET_ACCESS_KEY` | All AWS services | IAM secret |
| `BEDROCK_NOVA_SONIC_MODEL_ID` | `novaAgent.ts` | e.g. `amazon.nova-sonic-v2:0` |
| `BEDROCK_TITAN_EMBED_MODEL_ID` | `ragService.ts` | Titan Embeddings v2 model ID |
| `TURSO_DATABASE_URL` | `libsql.ts` | `libsql://...turso.io` |
| `TURSO_AUTH_TOKEN` | `libsql.ts` | Turso auth token |
| `S3_BUCKET_NAME` | `storageService.ts` | S3 bucket for recordings |
| `S3_RECORDINGS_PREFIX` | `storageService.ts` | Default: `recordings/` |
| `LANCEDB_PATH` | `lancedb.ts` | Local path, default `./data/lancedb` |
| `PORT` | `server.ts` | HTTP server port, default `3000` |
| `FRONTEND_URL` | `server.ts` | CORS allowed origin |

---

## Available OpenCode Skills

The following skills are available in `.opencode/skills/`. Load them when the relevant task comes up.

| Skill File | When to Use |
|---|---|
| `ingest-protocols.md` | User wants to add, update, or re-ingest emergency protocol documents |
| `seed-db.md` | User wants to populate the database with sample/test data |
| `run-migrations.md` | User changes the DB schema, adds a column, or sets up a fresh environment |
| `build-docker.md` | User wants to build the Docker image or push to AWS ECR |
| `deploy-ecs.md` | User wants to deploy a new version to AWS ECS |
