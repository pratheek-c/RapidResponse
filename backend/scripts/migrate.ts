/**
 * Database migration runner.
 *
 * Usage:
 *   bun run db:migrate          — apply all pending migrations
 *   bun run db:migrate status   — show which migrations have been applied
 *
 * Migrations are idempotent: already-applied versions are skipped.
 * Migration files live in backend/src/db/migrations/ as NNN_name.sql
 */

import { createClient } from "@libsql/client";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const MIGRATIONS_DIR = resolve(
  import.meta.dir,
  "../src/db/migrations"
);

async function getClient() {
  const url = process.env["LIBSQL_URL"] ?? "file:./data/rapidresponse.db";
  const authToken = process.env["LIBSQL_AUTH_TOKEN"];
  return createClient({ url, authToken });
}

async function ensureMigrationsTable(db: Awaited<ReturnType<typeof getClient>>) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
}

async function getAppliedVersions(
  db: Awaited<ReturnType<typeof getClient>>
): Promise<Set<string>> {
  const result = await db.execute(
    "SELECT version FROM schema_migrations ORDER BY version"
  );
  return new Set(result.rows.map((r) => r["version"] as string));
}

async function getMigrationFiles(): Promise<{ version: string; file: string }[]> {
  let entries: string[];
  try {
    entries = await readdir(MIGRATIONS_DIR);
  } catch {
    console.error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
    process.exit(1);
  }

  return entries
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({
      version: file.replace(".sql", ""),
      file: join(MIGRATIONS_DIR, file),
    }));
}

async function runMigrations() {
  const db = await getClient();

  try {
    await ensureMigrationsTable(db);
    const applied = await getAppliedVersions(db);
    const files = await getMigrationFiles();

    const pending = files.filter((m) => !applied.has(m.version));

    if (pending.length === 0) {
      console.log("All migrations are up to date.");
      return;
    }

    console.log(`Applying ${pending.length} migration(s)...`);

    for (const migration of pending) {
      console.log(`  → ${migration.version}`);
      const sql = await readFile(migration.file, "utf-8");

      try {
        await db.executeMultiple(sql);
        await db.execute({
          sql: "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
          args: [migration.version, new Date().toISOString()],
        });
        console.log(`  ✓ ${migration.version}`);
      } catch (err) {
        console.error(`  ✗ ${migration.version} failed:`, err);
        process.exit(1);
      }
    }

    console.log("Migrations complete.");
  } finally {
    db.close();
  }
}

async function showStatus() {
  const db = await getClient();

  try {
    await ensureMigrationsTable(db);
    const applied = await getAppliedVersions(db);
    const files = await getMigrationFiles();

    console.log("Migration status:");
    for (const migration of files) {
      const status = applied.has(migration.version) ? "[applied]" : "[pending]";
      console.log(`  ${status} ${migration.version}`);
    }
  } finally {
    db.close();
  }
}

const command = process.argv[2];

if (command === "status") {
  await showStatus();
} else {
  await runMigrations();
}
