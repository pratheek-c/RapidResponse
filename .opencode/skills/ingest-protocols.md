# Skill: Ingest Emergency Protocol Documents

## Trigger

Use this skill when the user says any of the following (or similar):
- "add protocol documents"
- "ingest protocols"
- "update emergency protocols"
- "add new guidelines to the RAG"
- "the protocol docs changed"
- "re-ingest protocols"
- "load protocol PDFs"

---

## Context

Before starting, read and understand:

1. **`backend/src/services/ragService.ts`** — LanceDB query and upsert logic
2. **`backend/scripts/ingest.ts`** — The ingestion pipeline entry point
3. **`backend/src/db/lancedb.ts`** — LanceDB collection schema for `protocols`

Protocol documents live in **`backend/protocols/`**. Supported formats: `.pdf`, `.txt`, `.md`.

Each document is:
1. Read and parsed into plain text
2. Split into chunks by section header (max 512 tokens, 50-token overlap)
3. Each chunk is embedded via **AWS Bedrock Titan Embeddings v2** (`BEDROCK_TITAN_EMBED_MODEL_ID`)
4. Upserted into the LanceDB **`protocols`** collection with fields:
   - `id` — UUID (`crypto.randomUUID()`)
   - `source_file` — filename of the origin document
   - `section` — detected section heading
   - `chunk_text` — raw text of the chunk
   - `embedding` — float32[1024] vector from Titan
   - `priority_keywords` — extracted keywords (fire, medical, cardiac, etc.)

---

## Steps

1. **Verify documents are in place**
   - Check `backend/protocols/` for new or updated files
   - Confirm the files are `.pdf`, `.txt`, or `.md`
   - If a new format is requested, update the parser in `backend/scripts/ingest.ts`

2. **Check environment variables are set**
   - `AWS_REGION` — must be set
   - `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — must be set
   - `BEDROCK_TITAN_EMBED_MODEL_ID` — must be set (e.g. `amazon.titan-embed-text-v2:0`)
   - `LANCEDB_PATH` — must be set (default: `./data/lancedb`)

3. **Run the ingestion script**

   ```bash
   bun run ingest:protocols
   ```

   This calls `backend/scripts/ingest.ts` which:
   - Scans `backend/protocols/` for all supported files
   - Parses and chunks each file
   - Calls Bedrock Titan for each chunk's embedding
   - Upserts into LanceDB `protocols` collection

4. **Verify ingestion succeeded**

   ```bash
   bun run ingest:protocols --verify
   ```

   Or query LanceDB directly in a REPL:
   ```typescript
   import { getLanceDB } from "./backend/src/db/lancedb.ts"
   const db = await getLanceDB()
   const tbl = await db.openTable("protocols")
   console.log(await tbl.countRows())
   ```

5. **Test RAG retrieval** — run a quick search to confirm the chunks are retrievable:

   ```bash
   bun backend/scripts/ingest.ts --test-query "chest pain"
   ```

   Expected: top-3 chunks from the ingested docs printed to stdout with cosine similarity scores.

---

## Commands

| Command | Description |
|---|---|
| `bun run ingest:protocols` | Ingest all docs in `backend/protocols/` |
| `bun run ingest:protocols --dry-run` | Parse and chunk without writing to LanceDB |
| `bun run ingest:protocols --verify` | Count rows in LanceDB protocols collection |

---

## Verification

After ingestion:

- [ ] `bun run ingest:protocols --verify` reports a row count > 0
- [ ] A test query returns at least 3 results with similarity > 0.7
- [ ] No errors in the ingestion output
- [ ] `bun test --filter ragService` passes

---

## Error Handling

| Error | Likely Cause | Fix |
|---|---|---|
| `ResourceNotFoundException` from Bedrock | Wrong model ID | Check `BEDROCK_TITAN_EMBED_MODEL_ID` env var |
| `AccessDeniedException` from Bedrock | IAM policy missing | Add `bedrock:InvokeModel` to IAM policy |
| `LanceDB table not found` | First run, no collection yet | The script auto-creates — check `LANCEDB_PATH` is writable |
| PDF parsing error | `pdf-parse` not installed | `bun add pdf-parse --filter backend` |
