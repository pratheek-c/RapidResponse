# RapidResponse.ai — Agent Guide

This is the authoritative context document for any AI coding agent working in this repository.
Read it fully before making any changes.

---

## Project Identity

**RapidResponse.ai** is a municipal-grade AI-powered 911 emergency dispatch platform. An AI voice
agent (AWS Bedrock Nova Sonic 2) autonomously handles incoming emergency calls from a browser,
triages callers using RAG-backed emergency protocols, classifies incidents, and surfaces live data
to human dispatchers via a React dashboard.

---

## Runtime — CRITICAL

**This project uses [Bun](https://bun.sh) as the JavaScript/TypeScript runtime. Not Node.js.**

| Task | Correct | Wrong |
|---|---|---|
| Run scripts | `bun run <script>` | `npm run`, `npx`, `node` |
| Install packages | `bun install` | `npm install`, `yarn`, `pnpm` |
| Add a package | `bun add <pkg> --filter backend` | `npm install <pkg>` |
| Execute a file | `bun src/index.ts` | `ts-node`, `tsx`, `node` |
| Run tests | `bun test` | `jest`, `vitest`, `mocha` |

**Never** use `npm`, `npx`, `yarn`, `pnpm`, `ts-node`, or `tsx`.

---

## Build, Lint & Test Commands

```bash
# Install all workspace deps
bun install

# Type-check (no emit)
bun run --filter backend  tsc --noEmit
bun run --filter frontend tsc --noEmit

# Run all tests
bun test

# Run backend tests only
bun test --filter backend

# Run a single test file
bun test backend/src/__tests__/services.test.ts

# Run a single named test (regex match on test description)
bun test --test-name-pattern "creates an incident"

# Dev servers
bun run dev:backend    # backend only (watch mode)
bun run dev:frontend   # frontend only (Vite)

# Production builds
bun run build:backend  # bun build → backend/dist/
bun run build:frontend # tsc && vite build → frontend/dist/

# Database
bun run db:migrate     # run all pending SQL migrations
bun run db:seed        # seed with sample data
bun run ingest:protocols  # chunk + embed protocol docs into LanceDB
```

---

## Monorepo Layout

Bun workspace monorepo. Root `package.json` declares `workspaces: ["backend", "frontend"]`.

```
rapidresponse/
├── package.json          # Root workspace
├── bunfig.toml
├── .env                  # Local env — never commit
├── .env.example          # Committed template
├── backend/
│   ├── src/
│   │   ├── agents/       # novaAgent.ts, reportAgent.ts, triageAgent.ts, dispatchBridgeAgent.ts
│   │   ├── config/env.ts # Env validation — lazy singleton
│   │   ├── db/           # libsql.ts, lancedb.ts, migrations/
│   │   ├── routes/       # One file per REST resource
│   │   ├── services/     # incidentService, ragService, storageService, sseService, …
│   │   ├── types/        # Shared backend types
│   │   └── ws/           # callHandler.ts (WebSocket)
│   └── scripts/          # ingest.ts, seed.ts, migrate.ts
└── frontend/
    └── src/
        ├── components/   # PascalCase.tsx
        ├── hooks/        # useCallSocket.ts, useIncidents.ts, …
        ├── pages/        # CallerView.tsx, DashboardView.tsx, …
        └── types/        # Frontend types
```

---

## TypeScript Rules

Both workspaces use `"strict": true`. The backend additionally enforces:

- `noImplicitAny: true`
- `noUnusedLocals: true`, `noUnusedParameters: true`
- `exactOptionalPropertyTypes: true`
- `noUncheckedIndexedAccess: true`

**Hard rules:**
- **No `any`** — use `unknown` with type guards if shape is uncertain
- No `// @ts-ignore` or `// @ts-expect-error` without an explanatory comment
- Use `type` for object shapes; use `interface` only when extension/merging is intended
- All async functions must explicitly handle errors — no unhandled promise rejections
- Named exports only; default exports are allowed only for React components
- Import with `.ts` / `.tsx` extensions in backend source (Bun requires them; `allowImportingTsExtensions: true`)
- Frontend path alias: `@/` maps to `src/`

---

## Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| Source files | `camelCase.ts` | `ragService.ts` |
| React components | `PascalCase.tsx` | `IncidentDetail.tsx` |
| Migration files | `NNN_snake_case.sql` | `009_roles.sql` |
| TS types/interfaces | `PascalCase` | `IncidentType` |
| Variables/functions | `camelCase` | `classifyIncident` |
| True constants | `SCREAMING_SNAKE_CASE` | `BEDROCK_NOVA_SONIC_MODEL_ID` |
| DB tables | `snake_case` plural | `transcription_turns` |
| DB columns | `snake_case` | `incident_id`, `created_at` |
| REST endpoints | `kebab-case` plural nouns | `/incidents`, `/dispatch` |

---

## Error Handling

- Wrap all libSQL operations in `try/catch` — DB errors must never crash the WebSocket handler
- Route handlers return typed JSON error responses: `{ ok: false, error: string }`
- Bedrock stream errors call `callbacks.onError(err)` and clean up the session — never `throw` from a stream event handler
- Use structured logging (`console.error("[module] message:", err)`) — never bare `console.log` for errors
- Required env vars throw at startup via `requireEnv()` in `config/env.ts` — fail fast, never silently

---

## Database Rules

1. **libSQL** = structured relational data only (incidents, transcriptions, units, dispatches)
2. **LanceDB** = vectors only (protocols, incident history, locations)
3. **S3** = binary data only (audio chunks `.webm`, transcript exports `.json`)
4. All SQL statements use parameterized queries — no string interpolation ever
5. IDs are UUIDs: `crypto.randomUUID()` — never auto-increment integers
6. Timestamps: ISO 8601 strings in `TEXT` columns
7. Migrations are numbered `NNN_` sequentially — **never modify** an existing migration file
8. `distanceType("cosine")` must be set consistently for LanceDB — the default `"l2"` is wrong for Titan embeddings
9. Always use presigned URLs for S3 playback — never expose bucket URLs directly

---

## Testing Conventions

- Test runner: `bun test` (Jest-compatible API via `bun:test`)
- Test files: `backend/src/__tests__/*.test.ts`
- Import from `bun:test`: `describe`, `it`, `expect`, `beforeEach`, `afterEach`
- Set required `process.env` values **before** any import that triggers `env.ts` loading
- Use `createClient({ url: ":memory:" })` for libSQL in every test — never touch the real DB
- Apply all migrations to the in-memory DB via `db.executeMultiple(sql)` in a `buildTestDb()` helper
- Mock Bedrock with `bun:mock` — no real AWS credentials required to run any test
- Mock S3 via `bun:mock` — never make real S3 calls in tests
- LanceDB: use a temp path `./data/lancedb-test-${crypto.randomUUID()}` and clean up after

---

## Key Architectural Facts

- **Nova Sonic** requires HTTP/2: use `NodeHttp2Handler` from `@smithy/node-http-handler`
- Tool results must be sent on `contentEnd` with `stopReason: "TOOL_USE"` — not on the `toolUse` event
- `inputSchema.json` in tool specs is a **JSON string** (`JSON.stringify({...})`), not an object
- `turnDetectionConfiguration` is not supported by `amazon.nova-2-sonic-v1:0` — omit it
- Nova Sonic needs a text trigger (`"."` with `interactive: true`) to speak first; silence alone returns only `usageEvent`
- Browser audio must be raw **PCM 16-bit 16 kHz mono** via `ScriptProcessorNode` — `MediaRecorder` produces WebM/Opus which Nova Sonic cannot decode
- `Bun.serve()` must set `idleTimeout: 255` — the 10s default kills SSE connections
- Caddy must use `flush_interval -1` on the `/events` proxy — without it SSE events are buffered

---

## Do NOT

- Use `npm`, `npx`, `yarn`, `pnpm`, `ts-node`, or `tsx`
- Use the OpenAI SDK or OpenAI Realtime API — AWS Bedrock only
- Store embeddings or audio in libSQL
- Store relational data in LanceDB
- Use `any` in TypeScript
- Interpolate variables into SQL strings
- Modify existing migration files — always add a new numbered one
- Commit `.env` — only `.env.example` is committed
- Hardcode Bedrock model IDs — always read from env vars
- Expose S3 bucket URLs — always use presigned URLs

---

## Available OpenCode Skills

Load these from `.opencode/skills/` when the relevant task comes up:

| Skill | When to use |
|---|---|
| `ingest-protocols.md` | Adding or re-ingesting emergency protocol documents |
| `seed-db.md` | Populating the database with sample/test data |
| `run-migrations.md` | DB schema changes or fresh environment setup |
| `build-docker.md` | Building Docker images or pushing to AWS ECR |
| `deploy-ecs.md` | Deploying a new version to AWS ECS |
