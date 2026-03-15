/**
 * Application entry point.
 *
 * Runs DB migrations, initialises LanceDB collections, then starts the server.
 */

import { createClient } from "@libsql/client";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { env } from "./config/env.ts";
import { getLanceDb, initCollections } from "./db/lancedb.ts";
import { createServer } from "./server.ts";

const MIGRATIONS_DIR = resolve(import.meta.dir, "./db/migrations");

async function runMigrations(): Promise<void> {
  const db = createClient({
    url: env.LIBSQL_URL,
    authToken: env.LIBSQL_AUTH_TOKEN,
  });

  try {
    // Ensure schema_migrations table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);

    const applied = new Set(
      (await db.execute("SELECT version FROM schema_migrations")).rows.map(
        (r) => r["version"] as string
      )
    );

    const files = [
      "001_initial.sql",
      "002_add_indexes.sql",
      "003_add_caller_address.sql",
      "004_dispatch_tables.sql",
      "005_fix_units_fk.sql",
      "006_fix_transcription_dispatches_fk.sql",
    ];

    for (const file of files) {
      const version = file.replace(".sql", "");
      if (applied.has(version)) continue;

      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf-8");
      await db.executeMultiple(sql);
      await db.execute({
        sql: "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        args: [version, new Date().toISOString()],
      });
      console.log(`[migrate] Applied: ${version}`);
    }
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  console.log("[startup] Running migrations...");
  await runMigrations();

  console.log("[startup] Initialising LanceDB collections...");
  const lanceDb = await getLanceDb();
  await initCollections(lanceDb);

  const server = createServer();
  console.log(`[startup] RapidResponse.ai backend listening on port ${env.PORT}`);
}

main().catch((err: unknown) => {
  console.error("[startup] Fatal error:", err);
  process.exit(1);
});
