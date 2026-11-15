#!/usr/bin/env node
/**
 * db/reset.mjs — DESTRUCTIVE: drop every object this project owns, then re-migrate.
 *
 * Guarded behind an explicit confirmation so it can never run by accident:
 *   npm run db:reset            # prompts
 *   npm run db:reset -- --yes   # non-interactive
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import pg from "pg";

const DROP_ORDER = [
  "sessions",
  "payments",
  "expenses",
  "gate_logs",
  "trainer_profiles",
  "member_profiles",
  "user_activity",
  "memberships",
  "membership_plans",
  "users",
  "schema_migrations",
];

const DROP_TYPES = ["payment_kind", "gate_action", "presence_status", "trainer_status", "user_role"];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const confirmed =
    process.argv.includes("--yes") ||
    (await (async () => {
      const rl = createInterface({ input: stdin, output: stdout });
      const answer = await rl.question(
        "This will DELETE all rows in the AURA database. Type 'DELETE' to continue: "
      );
      rl.close();
      return answer.trim() === "DELETE";
    })());

  if (!confirmed) {
    console.log("Aborted. Nothing was changed.");
    process.exit(0);
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: true } : undefined,
  });
  await client.connect();

  for (const table of DROP_ORDER) {
    await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }
  for (const type of DROP_TYPES) {
    await client.query(`DROP TYPE IF EXISTS ${type} CASCADE`);
  }
  await client.query("DROP FUNCTION IF EXISTS set_updated_at() CASCADE");

  await client.end();
  console.log("Schema dropped.");
  console.log("Next: npm run db:migrate && npm run db:seed");
}

main().catch((err) => {
  console.error("Reset failed:", err.message);
  process.exit(1);
});
