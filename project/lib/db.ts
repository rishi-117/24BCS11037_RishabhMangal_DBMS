import { Pool, types, type PoolConfig } from "pg";

/**
 * Return `date` columns (OID 1082) as plain `YYYY-MM-DD` strings.
 *
 * By default node-postgres converts them to a Date at *local* midnight, which
 * shifts the calendar day once serialised with toISOString() in any non-UTC
 * timezone. Membership periods are calendar dates, so keeping them as strings
 * avoids off-by-one-day errors entirely.
 */
types.setTypeParser(1082, (value: string) => value);

/**
 * Single pg Pool per server process.
 *
 * Next.js (and Vercel's serverless runtime) can evaluate a module more than once
 * per process, so the pool is cached on globalThis to avoid leaking connections.
 */
const globalForPg = globalThis as unknown as { __auraPool?: Pool };

function buildConfig(): PoolConfig {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not configured. Copy .env.example to .env.local and set it, " +
        "or add DATABASE_URL to your Vercel project environment variables."
    );
  }

  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);

  return {
    connectionString,
    // Hosted providers (Neon, Supabase, ...) require TLS. Local sockets do not.
    ssl: isLocal ? undefined : { rejectUnauthorized: true },
    max: Number(process.env.PG_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: "aura-athletic-erp",
  };
}

export function getPool(): Pool {
  if (!globalForPg.__auraPool) {
    globalForPg.__auraPool = new Pool(buildConfig());

    globalForPg.__auraPool.on("error", (err) => {
      console.error("[db] idle client error:", err.message);
    });
  }

  return globalForPg.__auraPool;
}

/** Run a parameterised query. Always use $1, $2 … placeholders — never interpolate. */
export async function query<T extends object = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await getPool().query(text, params);
  return result.rows as T[];
}

/** Convenience for queries expected to touch exactly zero or one row. */
export async function queryOne<T extends object = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Run a callback inside BEGIN/COMMIT, rolling back on any thrown error.
 * Used wherever two writes must land together (check-in counter + gate log,
 * membership term + payment receipt, trainer approval + audit fields).
 */
export async function transaction<T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
