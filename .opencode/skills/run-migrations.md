# Skill: Run Database Migrations

## Trigger

Use this skill when the user says any of the following (or similar):
- "run migrations"
- "update the database schema"
- "add a column"
- "set up a fresh database"
- "I added a new table"
- "migrate the DB"
- "schema is out of date"
- "apply pending migrations"

---

## Context

Before starting, read and understand:

1. **`backend/src/db/migrations/`** — All numbered SQL migration files
2. **`backend/scripts/migrate.ts`** — The migration runner script
3. **`backend/src/db/libsql.ts`** — libSQL client initialization

**Migration rules (non-negotiable):**
- Migration files are numbered sequentially: `001_`, `002_`, etc.
- **Never modify an existing migration file.** Always create a new one.
- Each migration file is plain SQL — no TypeScript logic inside migrations.
- Migrations are tracked in a `_migrations` table in libSQL (created automatically on first run).
- IDs are always UUIDs (`crypto.randomUUID()`), never auto-increment integers.
- Timestamps are ISO 8601 strings stored as `TEXT`.

---

## Steps

### Running Existing Migrations

1. **Check current migration status**

   ```bash
   bun run db:status
   ```

   This prints which migrations have been applied and which are pending.

2. **Apply all pending migrations**

   ```bash
   bun run db:migrate
   ```

   The runner reads all `.sql` files in `backend/src/db/migrations/` in numeric order and executes any that haven't been recorded in the `_migrations` table.

3. **Verify the schema**

   After migration, verify the tables exist:
   ```bash
   bun run db:status
   ```

   All migrations should show `applied`.

---

### Adding a New Migration

When the user asks to add a column, create a table, or change the schema:

1. **Find the next migration number**

   Look at existing files in `backend/src/db/migrations/`. If the last is `003_add_indexes.sql`, the next is `004_`.

2. **Create the new migration file**

   File name format: `NNN_short_snake_case_description.sql`

   Example — adding a `notes` column to incidents:
   ```sql
   -- 004_add_incident_notes.sql
   ALTER TABLE incidents ADD COLUMN notes TEXT;
   ```

3. **Run the migration**

   ```bash
   bun run db:migrate
   ```

4. **Update TypeScript types** if needed

   If you added a column, update the corresponding type in `backend/src/types/index.ts` and the relevant service file.

---

## Migration File Template

```sql
-- NNN_description.sql
-- Description: What this migration does and why

-- Forward migration
CREATE TABLE IF NOT EXISTS example_table (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Add index if needed
CREATE INDEX IF NOT EXISTS idx_example_table_name ON example_table(name);
```

---

## Current Schema Reference

```sql
-- 001_initial.sql
incidents      (id, caller_id, type, priority, status, location, lat, lng, s2_cell_id, created_at, updated_at)
transcriptions (id, incident_id, speaker, text, timestamp)
units          (id, name, type, status, lat, lng, updated_at)
dispatches     (id, incident_id, unit_id, dispatched_at, arrived_at, cleared_at)
_migrations    (id, filename, applied_at)  -- internal migration tracker
```

---

## Commands

| Command | Description |
|---|---|
| `bun run db:migrate` | Apply all pending migrations |
| `bun run db:status` | Show applied and pending migrations |

---

## Verification

After running migrations:

- [ ] `bun run db:status` shows all migrations as `applied`
- [ ] No error output from `bun run db:migrate`
- [ ] If a new table was added: `bun run db:seed` still runs without errors
- [ ] If a column was added: the relevant TypeScript type has been updated
- [ ] `bun test` passes after schema change

---

## Error Handling

| Error | Likely Cause | Fix |
|---|---|---|
| `no such table: _migrations` | First migration run | Normal — `_migrations` table is auto-created |
| `duplicate column name` | Migration already partially applied | Check `db:status`, mark migration as applied manually if needed |
| `SQLITE_ERROR: syntax error` | Invalid SQL in migration file | Fix the SQL; never edit an already-applied migration |
| `LIBSQL_CLIENT_HTTP: Unauthorized` | Wrong auth token | Check `TURSO_AUTH_TOKEN` in `.env` |
| Migration skipped | File naming gap (e.g. `001`, `003` — no `002`) | Rename files to close the gap, or investigate why `002` is missing |
