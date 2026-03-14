# Skill: Seed Database

## Trigger

Use this skill when the user says any of the following (or similar):
- "seed the database"
- "add test data"
- "populate with sample incidents"
- "I need some dummy data to test the dashboard"
- "set up dev data"
- "reset and reseed"
- "create sample units and incidents"

---

## Context

Before starting, read and understand:

1. **`backend/scripts/seed.ts`** — The seed script entry point
2. **`backend/src/db/libsql.ts`** — libSQL client and table schema types
3. **`backend/src/db/migrations/`** — Ensure migrations are up to date before seeding

The seed script populates **libSQL (Turso)** with realistic sample data across all four tables:
- `incidents` — sample active, dispatched, and resolved incidents
- `transcriptions` — 3–5 turns per incident (caller + AI utterances)
- `units` — police, fire, and EMS units with varying statuses
- `dispatches` — linking units to incidents

**Seeding is idempotent** — running it twice should not create duplicate records. The script uses `INSERT OR IGNORE` with stable UUIDs derived from a seed phrase.

---

## Steps

1. **Ensure migrations are current first**

   ```bash
   bun run db:migrate
   ```

   Never seed against a schema that is behind — the seed script will fail on missing columns.

2. **Check environment variables**
   - `TURSO_DATABASE_URL` — must be set
   - `TURSO_AUTH_TOKEN` — must be set

3. **Run the seed script**

   ```bash
   bun run db:seed
   ```

4. **Verify the seed data**

   ```bash
   bun run db:seed --verify
   ```

   Expected output:
   ```
   incidents:     10 rows
   transcriptions: 47 rows
   units:          8 rows
   dispatches:     6 rows
   ```

5. **Reset and reseed (optional)** — wipes all existing data and reseeds from scratch:

   ```bash
   bun run db:seed --reset
   ```

   Use only in local development. Never run `--reset` against a production database.

---

## Sample Data Shape

### Incidents

```typescript
{
  id: "550e8400-e29b-41d4-a716-446655440001",
  caller_id: "caller-001",
  type: "medical",           // medical | fire | law | hazmat | other
  priority: 1,               // 1 = critical, 5 = low
  status: "active",          // active | dispatched | resolved | closed
  location: "123 Main St, Springfield",
  lat: 37.7749,
  lng: -122.4194,
  s2_cell_id: "9q8yywe",
  created_at: "2026-03-14T10:00:00.000Z",
  updated_at: "2026-03-14T10:00:00.000Z"
}
```

### Units

```typescript
{
  id: "unit-fire-001",
  name: "Engine 7",
  type: "fire",              // police | fire | ems | hazmat
  status: "available",       // available | dispatched | on_scene | off_duty
  lat: 37.7800,
  lng: -122.4100,
  updated_at: "2026-03-14T09:55:00.000Z"
}
```

### Incident Types Seeded

| Type | Count | Priority Range |
|---|---|---|
| Medical (cardiac arrest) | 2 | 1 |
| Fire (structure fire) | 2 | 1–2 |
| Law enforcement (robbery) | 2 | 2–3 |
| Medical (fall/injury) | 2 | 3–4 |
| Noise complaint | 2 | 5 |

---

## Commands

| Command | Description |
|---|---|
| `bun run db:seed` | Seed all tables with sample data |
| `bun run db:seed --verify` | Print row counts for all seeded tables |
| `bun run db:seed --reset` | Truncate all tables then reseed (dev only) |

---

## Verification

- [ ] `bun run db:seed --verify` shows expected row counts
- [ ] Dispatcher dashboard loads and shows seeded incidents
- [ ] At least one incident of each type is visible
- [ ] Units list shows available and dispatched units
- [ ] `bun test --filter incidentService` passes with seeded data

---

## Error Handling

| Error | Likely Cause | Fix |
|---|---|---|
| `SQLITE_ERROR: no such table` | Migrations not run | Run `bun run db:migrate` first |
| `LIBSQL_CLIENT_HTTP: Unauthorized` | Wrong auth token | Check `TURSO_AUTH_TOKEN` |
| `connection refused` | Wrong database URL | Check `TURSO_DATABASE_URL` |
| Duplicate key errors | Non-idempotent seed | Check `INSERT OR IGNORE` logic in `seed.ts` |
