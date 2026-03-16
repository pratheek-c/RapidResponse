# RapidResponse.ai — Project Story

---

## Inspiration

Legacy 911 Computer-Aided Dispatch (CAD) systems are decades old. Many municipal dispatch centers still run software built in the 1990s — green-screen terminals, manual code lookups, dispatchers furiously typing while simultaneously talking to a panicked caller and radioing units. During peak hours a single dispatcher can be managing six or more simultaneous incidents, each demanding full attention.

The cognitive load is brutal, and the consequences of overload are measured in minutes — and lives.

We asked a simple question: what if the *first* responder to every call wasn't a human at all, but an AI that never gets tired, never mishears a cross-street, and can simultaneously query every protocol in the department's manual in under a second?

AWS Bedrock's Nova Sonic 2 made that question answerable. It is the first generally available, fully bidirectional voice model with native tool use — capable of listening, speaking, and triggering backend actions all within a single streaming session. That combination unlocked something that wasn't possible even a year ago: a fully autonomous AI triage agent that speaks to callers in real time, follows MPDS-style protocols, and hands a classified, annotated incident to a human dispatcher the moment they need to act.

---

## What We Built

**RapidResponse.ai** is a municipal-grade AI-powered 911 emergency dispatch platform. An AI voice agent autonomously handles incoming emergency calls from any browser, triages callers using RAG-backed emergency protocol documents, classifies incidents by type and priority, and surfaces live structured data to human dispatchers on a React dashboard — all in real time.

**Key capabilities:**

- **Live AI voice call** — callers speak from any browser; Nova Sonic 2 responds in natural speech
- **RAG-backed protocol retrieval** — MPDS-style protocol documents chunked, embedded, and stored in LanceDB; top-3 relevant chunks injected into every Nova Sonic turn
- **Incident classification** — type (`medical`, `fire`, `police`, `hazmat`, `search_rescue`, `traffic`) and priority P1–P4
- **Covert distress detection** — Nova Sonic flags silent domestic/hostage situations; dashboard shows a "Silent Approach" alert to responding units
- **Role-based dispatcher dashboard** — separate views for dispatchers and unit officers; live SSE event bus with 18 distinct event types
- **AI incident reports** — Nova Lite generates evolving structured reports every ~30s and a final close summary
- **Unit dispatch** — proximity-ranked unit suggestions using S2 cell geometry; manual and AI-auto dispatch flows
- **Full audit trail** — every transcript turn, dispatch action, and Q&A exchange saved to libSQL; raw audio stored in S3

---

## How We Built It

### Runtime & Monorepo

We used **Bun** as the JavaScript/TypeScript runtime throughout — no Node.js, no `ts-node`. Bun executes TypeScript natively, ships a built-in HTTP/WebSocket server (`Bun.serve()`), and starts in under 30ms. The project is a Bun workspace monorepo: `backend/` (Bun HTTP + WebSocket server) and `frontend/` (React 18 + Vite), orchestrated from the root `package.json`.

### The Voice Agent — Nova Sonic Bidirectional Stream

The core of the system is a persistent bidirectional HTTP/2 stream to AWS Bedrock Nova Sonic 2, opened via `InvokeModelWithBidirectionalStreamCommand`. This is not a request/response API — it is a long-lived stream that simultaneously carries audio frames inbound and AI audio + transcript + tool calls outbound.

Audio from the browser is captured as raw **PCM 16-bit, 16 kHz, mono** using a `ScriptProcessorNode` at 512 samples per frame (~32 ms chunks). Each frame is base64-encoded and sent as a WebSocket message to the backend, which wraps it in the Nova Sonic `audioInput` event format and forwards it into the Bedrock stream.

The PCM normalization from float32 (Web Audio API) to int16 (Nova Sonic LPCM):

$$s_{\text{int16}} = \text{clamp}\!\left(\lfloor s_{\text{float32}} \times 32767 \rceil,\ -32768,\ 32767\right)$$

Nova Sonic responds with 24 kHz PCM audio, which is decoded on the client:

$$s_{\text{float32}} = \frac{s_{\text{int16}}}{32768}$$

The agent uses **tool use** to trigger backend actions mid-conversation:

| Tool | Trigger | Action |
|---|---|---|
| `classify_incident` | Enough information gathered | Update type + priority in libSQL, push SSE |
| `get_protocol` | Protocol guidance needed | RAG query → inject top-3 chunks into next turn |
| `dispatch_unit` | Unit needed | Create dispatch record, notify dashboard |
| `flag_covert_distress` | Silent distress detected | Set `covert_distress=1`, push SSE with silent approach flag |

One critical implementation detail: tool results must be sent when the stream emits `contentEnd` with `stopReason: "TOOL_USE"` — **not** on the `toolUse` event itself. Getting this wrong causes the session to hang indefinitely.

### RAG — Protocol Retrieval with LanceDB

Emergency protocol documents (PDF, TXT, Markdown) are chunked into 512-token segments with 50-token overlap, embedded via **AWS Bedrock Titan Embeddings v2** (1024-dimensional vectors), and stored in **LanceDB** — an embedded vector database that runs in-process with zero infrastructure.

At query time, the top-3 protocol chunks are retrieved by **cosine similarity**:

$$\text{sim}(\mathbf{q}, \mathbf{d}) = \frac{\mathbf{q} \cdot \mathbf{d}}{\|\mathbf{q}\| \cdot \|\mathbf{d}\|}$$

where $\mathbf{q}$ is the query embedding and $\mathbf{d}$ is each stored chunk embedding. LanceDB must be configured with `distanceType("cosine")` consistently at both index creation and query time — using the default `"l2"` produces incorrect rankings for Titan embeddings.

### Geospatial Proximity — S2 Cell Geometry

Unit proximity is indexed using **S2 cell tokens** — a hierarchical spherical geometry system that tiles the Earth into a quad-tree of cells. Each caller location and unit position is encoded as an S2 cell token at level 13 (~1.3 km² average area).

The cell area at level $\ell$ is approximately:

$$A_\ell \approx \frac{4\pi}{6 \cdot 4^\ell} \text{ steradians} \approx \frac{510{,}000{,}000}{6 \cdot 4^\ell} \text{ km}^2$$

At $\ell = 13$: $A_{13} \approx 1.27 \text{ km}^2$, giving useful neighborhood-level granularity without expensive PostGIS infrastructure. S2 tokens are stored as `Utf8` strings in LanceDB and used as pre-filters on cosine vector search.

### Priority Scoring

Incidents are classified into four priority tiers by Nova Sonic's `classify_incident` tool. The triage agent additionally evaluates escalation using a weighted signal score:

$$P_{\text{score}} = \sum_{i} w_i \cdot x_i, \quad \text{escalate if } P_{\text{score}} \geq \theta$$

where $x_i \in \{0,1\}$ are binary signals (e.g., weapon present, unconscious caller, multiple victims) and $w_i$ are protocol-defined weights. The threshold $\theta$ is set per incident type. P1 = life-threatening, P2 = urgent, P3 = standard, P4 = non-urgent.

### Storage Architecture

We enforced strict separation of concerns across three stores:

| Store | Used for |
|---|---|
| **libSQL** (embedded file) | All structured relational data — incidents, transcripts, units, dispatches, Q&A, sessions |
| **LanceDB** (embedded) | Vector collections — protocols, incident history, locations |
| **AWS S3** | Binary data — raw audio chunks, final transcript JSON exports |

libSQL runs as an embedded file (`file:///data/rapidresponse.db`) with zero server setup. Both databases write to a named Docker volume (`/data`) so data survives container replacement.

### Deployment

The system ships as two Docker containers: a **Bun backend** (`oven/bun:1.2-alpine`) and a **Caddy frontend** (`caddy:2-alpine`). The frontend Dockerfile uses a two-stage build — Vite inlines `VITE_*` Firebase keys at build time via Docker `ARG`. Caddy handles WebSocket upgrade pass-through, and SSE buffering is disabled with `flush_interval -1` to ensure each event reaches the dashboard instantly. The backend targets **AWS ECS (Fargate)** with credentials injected via IAM Task Role — never baked into the image.

---

## Challenges

**Nova Sonic's HTTP/2-only requirement.** The standard AWS SDK HTTP handler does not support HTTP/2 bidirectional streams. We had to explicitly configure `NodeHttp2Handler` from `@smithy/node-http-handler`. Without it, the stream silently fails to open.

**Getting Nova Sonic to speak first.** Nova Sonic does not spontaneously initiate speech. Sending silence only returns `usageEvent` payloads — the model waits. The solution: inject a USER text content block (`"."` with `interactive: true`) immediately after session start, which triggers the "911, what's your emergency?" greeting.

**Tool schema double-encoding.** The `inputSchema.json` field in Nova Sonic tool definitions must be a **JSON string** (i.e., `JSON.stringify({...})`), not a plain object. Passing an object causes the session to return a cryptic `"unexpected error"`. This is not documented clearly in the AWS SDK — we discovered it by diffing against AWS's own Python reference examples.

**LanceDB native addon.** `@lancedb/lancedb` ships a compiled C++ `.node` addon. This means `bun build --compile` (single binary) is not viable — the native addon cannot be bundled. Instead, the Docker image copies both `dist/` and `node_modules/` to the runner stage and installs `libstdc++` via Alpine's package manager.

**Browser AudioContext auto-suspend.** Browsers suspend `AudioContext` after a period of inactivity. Attempting to play Nova Sonic's audio response on a suspended context produces silence. The fix: call `ctx.resume()` before scheduling each buffer source — and handle the promise correctly to avoid a race condition.

**SSE connection timeouts.** Bun's default `idleTimeout` is 10 seconds — enough to kill every SSE connection on the dispatcher dashboard within the first idle moment. Setting `idleTimeout: 255` (the maximum Bun allows) resolved this.

---

## What We Learned

Building RapidResponse.ai taught us that the gap between "AI demo" and "production-grade AI system" is almost entirely in the infrastructure plumbing — not the model itself. Nova Sonic is remarkably capable out of the box; the hard problems were HTTP/2 stream lifecycle management, binary audio encoding, database schema evolution, and container image design.

We also learned to respect the data separation principle deeply. The instinct to throw everything into one database is strong. Enforcing strict boundaries — vectors in LanceDB, relations in libSQL, blobs in S3 — kept each system doing what it does best and made the codebase dramatically easier to reason about as it scaled from a proof-of-concept to a platform with 9 migrations, 18 SSE event types, and a full role-based access system.

Most importantly: emergency dispatch is a domain where the cost of failure is measured in human lives. That kept us honest about every architectural decision, every edge case, and every line of error handling. AI can augment dispatchers and reduce cognitive load — but only if the system beneath it is genuinely reliable.
