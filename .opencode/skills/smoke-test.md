# Skill: Smoke Test

## Trigger

Use this skill when the user asks for quick validation, for example:
- "run a smoke test"
- "quick sanity check"
- "is the app still working"
- "verify backend/frontend routes"

---

## Purpose

Run a fast end-to-end sanity pass without deep integration test overhead.

This skill checks:
1. Backend service boots
2. Core backend endpoints respond
3. Frontend dev server boots
4. Frontend shell routes render (`/`, `/login`, `/dashboard`)

---

## Preconditions

- Use Bun commands only.
- Run from repo root.
- If schema or seed-sensitive routes are tested, run migrations first.

---

## Steps

### 1) Prepare backend data shape (safe, idempotent)

```bash
bun run --filter backend db:migrate
bun run --filter backend seed:demo
```

### 2) Backend smoke test

Start backend in background, wait until ready, then hit minimal API paths.

Checks:
- `GET /health`
- `GET /incidents?limit=1`
- `GET /units?status=available`
- `POST /dispatch/accept` (single known demo incident + unit)
- `GET /incidents/:id` reflects dispatch status update

Example command sequence:

```bash
bun run --filter backend start > backend_smoke.log 2>&1 & BACK_PID=$!; \
for i in {1..20}; do if curl -sS "http://localhost:3000/health" > /dev/null; then break; fi; sleep 1; done; \
curl -sS "http://localhost:3000/health"; \
curl -sS "http://localhost:3000/incidents?limit=1"; \
curl -sS "http://localhost:3000/units?status=available"; \
curl -sS -X POST "http://localhost:3000/dispatch/accept" -H "Content-Type: application/json" -d '{"incident_id":"22222222-0001-0001-0001-000000000001","unit_ids":["11111111-0003-0001-0001-000000000001"],"officer_id":"D-SMOKE"}'; \
curl -sS "http://localhost:3000/incidents/22222222-0001-0001-0001-000000000001"; \
kill $BACK_PID; wait $BACK_PID 2>/dev/null
```

### 3) Frontend smoke test

Start frontend on a dedicated port to avoid collisions.

Checks:
- Dev server starts
- `GET /` returns app shell
- `GET /login` returns app shell
- `GET /dashboard` returns app shell

Example command sequence:

```bash
bun run --filter frontend dev --host 127.0.0.1 --port 5199 --strictPort > frontend_smoke.log 2>&1 & FRONT_PID=$!; \
for i in {1..30}; do if curl -sS "http://127.0.0.1:5199/" > /dev/null; then break; fi; sleep 1; done; \
curl -sS "http://127.0.0.1:5199/"; \
curl -sS "http://127.0.0.1:5199/login"; \
curl -sS "http://127.0.0.1:5199/dashboard"; \
kill $FRONT_PID; wait $FRONT_PID 2>/dev/null
```

### 4) Cleanup

Remove temporary logs created by this workflow.

```bash
rm "backend_smoke.log" "frontend_smoke.log"
```

---

## Pass Criteria

- Backend returns HTTP 200 for `health`, `incidents`, `units`.
- `dispatch/accept` returns `ok: true` and incident status becomes `dispatched`.
- Frontend dev server starts and app shell returns for `/`, `/login`, `/dashboard`.

---

## Notes

- This is a smoke test, not a full correctness test.
- For deeper verification, follow with `bun test` and targeted route/component tests.
