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
- Uses `@aws-sdk/client-bedrock-runtime` with `InvokeModelWithBidirectionalStreamCommand`
- Requires `@smithy/node-http-handler` (`NodeHttp2Handler`) — Nova Sonic uses HTTP/2 only
- Audio format: PCM 16-bit, 16kHz mono input / 24kHz mono output (`audio/lpcm`, base64-encoded)
- Audio frames are ~32ms each; audio data is base64-encoded in every `audioInput` event
- Maximum session duration: 8 minutes. Implement session renewal at 7m30s for long calls
- The Nova Sonic system prompt includes: role definition, city/department context, current RAG protocol context (injected per call), tool definitions
- Nova Sonic uses **tool use** to trigger backend actions:
  - `classify_incident(type, priority)` — fires when AI has enough info to classify
  - `get_protocol(query)` — requests a RAG lookup from LanceDB
  - `dispatch_unit(incident_id, unit_type)` — requests dispatcher notification
- Tool result must be sent on `contentEnd` with `stopReason: "TOOL_USE"` — **not** on the `toolUse` event itself
- On `{ "interrupted": true }` in a `textOutput` block, flush the audio output queue immediately (barge-in)
- **Do NOT** use the OpenAI SDK or OpenAI Realtime API. AWS Bedrock SDK only.

### AWS Bedrock — Titan Embeddings v2

- **File:** `backend/src/services/ragService.ts`
- Used to embed protocol document chunks and incident summaries
- Model ID stored in `BEDROCK_TITAN_EMBED_MODEL_ID` env var
- Returns 1024-dimension float32 vectors

### LanceDB

- **File:** `backend/src/db/lancedb.ts`
- Open-source embedded vector database. Package: `@lancedb/lancedb` (not the legacy `vectordb` package). Peer dep: `apache-arrow >=15.0.0 <=18.1.0`.
- Data directory: `LANCEDB_PATH` env var (default `./data/lancedb`)
- Three collections:

  | Collection | Purpose |
  |---|---|
  | `protocols` | Chunked emergency protocol docs for RAG |
  | `incidents_history` | Past incident summaries for pattern matching |
  | `locations` | Geocoded addresses with S2 cell IDs for proximity search |

- S2 geometry is used for location indexing. S2 cell tokens are stored as `Utf8` strings and used as pre-filters alongside cosine vector search. Use `s2-geometry` (pure JS, no native bindings) — do **not** use the archived `mapbox/node-s2` package.
- Always use `distanceType("cosine")` — must match at both index creation and query time. The default `"l2"` is incorrect for Titan embeddings.
- **LanceDB is for vectors only.** Never store structured relational data in LanceDB.

### libSQL (Open-Source Embedded)

- **File:** `backend/src/db/libsql.ts`
- Client: `@libsql/client`
- **Default mode: embedded file** — `LIBSQL_URL=file:./data/rapidresponse.db`. No server, no cloud account required. Data lives on disk next to the app.
- **Optional networked mode:** run the open-source `sqld` server (`ghcr.io/tursodatabase/libsql-server`) and set `LIBSQL_URL=http://localhost:8080`. Set `LIBSQL_AUTH_TOKEN` only if sqld is configured with auth.
- Connection: `createClient({ url: env.LIBSQL_URL, authToken: env.LIBSQL_AUTH_TOKEN })` — works for both `file:` and `http:` schemes identically.
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
| `BEDROCK_NOVA_SONIC_MODEL_ID` | `novaAgent.ts` | e.g. `amazon.nova-2-sonic-v1:0` |
| `BEDROCK_TITAN_EMBED_MODEL_ID` | `ragService.ts` | Titan Embeddings v2 model ID |
| `LIBSQL_URL` | `libsql.ts` | `file:./data/rapidresponse.db` (default) or `http://localhost:8080` (sqld) |
| `LIBSQL_AUTH_TOKEN` | `libsql.ts` | Optional — only required when using sqld with auth enabled |
| `S3_BUCKET_NAME` | `storageService.ts` | S3 bucket for recordings |
| `S3_RECORDINGS_PREFIX` | `storageService.ts` | Default: `recordings/` |
| `LANCEDB_PATH` | `lancedb.ts` | Local path, default `./data/lancedb` |
| `PORT` | `server.ts` | HTTP server port, default `3000` |
| `FRONTEND_URL` | `server.ts` | CORS allowed origin |
| `DISPATCH_CITY` | `novaAgent.ts` | City name injected into Nova Sonic system prompt |
| `DISPATCH_DEPT` | `novaAgent.ts` | Department name injected into Nova Sonic system prompt |

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


 ---
    backend/src/agents/novaAgent.ts

    - encodeChunk: Wraps events as { chunk: { bytes: JSON.stringify({ event: { [eventType]: payload } }) } }
    - turnDetectionConfiguration removed from sessionStart — not supported by amazon.nova-2-sonic-v1:0 (Nova 2 Sonic); caused "unexpected
    error"
    - toolConfiguration tools: Changed inputSchema.json back to JSON.stringify({...}) (JSON string, not object) — Nova Sonic bidirectional
    stream requires doubly-encoded JSON string
    - audioType: "SPEECH" kept in audioOutputConfiguration (confirmed correct per AWS Python examples)
    - Text trigger added: USER text content "." with interactive: true before AUDIO content — makes Nova Sonic speak first ("911, what's your
    emergency?")
    - Silence approach removed: replaced with text trigger
    - Transcript accumulation: uses currentTextBlock (stack-based) instead of Map, since response contentStart has no contentName
    - Tool result format: role: "TOOL", toolStatus: "SUCCESS"/"ERROR", toolResultConfiguration: { toolUseId, toolStatus }
    - System prompt: brief, empathetic, no formatting, 1-2 sentences per turn, handles interruptions
    - Session renewal timer: 7m30s timeout

    backend/src/agents/reportAgent.ts

    - Conditional credentials: uses env vars if present, otherwise falls back to AWS profile

    backend/src/services/ragService.ts

    - Fixed TypeScript type: InvokeModelCommandOutput instead of Awaited<ReturnType<...>>
    - Removed explicit credentials block (SDK auto-reads from env)

    backend/src/services/storageService.ts

    - Added followRegionRedirects: true to S3Client (bucket region mismatch fix)
    - Conditional credentials pattern

    backend/src/config/env.ts

    - AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN made optional (string | undefined)
    - AWS_PROFILE added as optional field
    - Only AWS_REGION required

    backend/src/server.ts

    - Added idleTimeout: 255 to Bun.serve() — prevents SSE connections timing out at 10s default

    backend/data/mock/dispatchers.json (created)

    - Schema matches reportAgent.ts MockData type exactly
    - Dispatchers: status: "on_duty", shift, role, certifications, assigned_zones, station: { desk, coords, address }
    - Zones: bbox: { sw, ne }, risk_level, primary_units
    - Hospitals: coords, trauma_level, ER_beds_available, helipad, specialties

    backend/.env (symlink)

    - backend/.env symlinked to project root .env so Bun finds credentials when run from backend/

    frontend/src/hooks/useCallSocket.ts

    - Replaced MediaRecorder (WebM/Opus) with ScriptProcessorNode for raw PCM 16kHz 16-bit mono — Nova Sonic requires LPCM
    - Added AudioContext.resume() before playback (browser auto-suspend fix)
    - Added stopCapture() helper for proper cleanup on call end

    frontend/src/pages/CallerView.tsx

    - Removed useEffect auto-arm — call only starts on "Call 911" button click
    - Removed hasAutoArmed ref

    .env.example

    - Model IDs updated to cross-region inference profile format: us.amazon.nova-sonic-v1:0, us.amazon.nova-lite-v1:0,
    us.amazon.titan-embed-text-v2:0

    ---
    Key discoveries:
    - turnDetectionConfiguration is not supported by amazon.nova-2-sonic-v1:0
    - Nova 2 Sonic requires text trigger ("." with interactive: true) to speak first — silence alone only returns usageEvent
    - inputSchema.json in tool specs must be a JSON string (doubly encoded), not an object
    - AWS sandbox in eu-north-1 uses amazon.nova-2-sonic-v1:0 directly (no cross-region inference profile needed)