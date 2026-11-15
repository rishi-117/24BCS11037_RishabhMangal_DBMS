#!/usr/bin/env node
/**
 * db/migrate.mjs — apply pending SQL migrations in db/migrations/.
 *
 * Each file is applied inside a transaction and recorded in schema_migrations,
 * so re-running is a no-op. Requires DATABASE_URL (see .env.example).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "migrations");

function connectionString() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
    process.exit(1);
  }
  return url;
}

async function main() {
  const client = new pg.Client({
    connectionString: connectionString(),
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: true } : undefined,
  });

  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await client.query("SELECT version FROM schema_migrations")).rows.map((r) => r.version)
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip   ${file} (already applied)`);
      continue;
    }

    const sql = readFileSync(join(migrationsDir, file), "utf8");
    process.stdout.write(`apply  ${file} ... `);

    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log("ok");
      count += 1;
    } catch (err) {
      await client.query("ROLLBACK");
      console.log("FAILED");
      throw err;
    }
  }

  console.log(count === 0 ? "\nDatabase already up to date." : `\nApplied ${count} migration(s).`);
  await client.end();
}

main().catch((err) => {
  console.error("\nMigration failed:", err.message);
  process.exit(1);
});
