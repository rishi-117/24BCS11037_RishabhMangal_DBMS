import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { query, queryOne } from "./db";
import type { UserRole } from "./types";

export const SESSION_COOKIE = "aura_session";
const SESSION_TTL_DAYS = 7;
const BCRYPT_ROUNDS = 12;

// ---------------------------------------------------------------------------
// Passwords — bcrypt with a per-user salt. Hashes are never returned to clients.
// ---------------------------------------------------------------------------

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ---------------------------------------------------------------------------
// Sessions — an opaque random token is handed to the browser; only its SHA-256
// digest is persisted, so a database leak cannot be replayed as a login.
// ---------------------------------------------------------------------------

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await query(
    "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [userId, digest(token), expiresAt]
  );

  return { token, expiresAt };
}

export async function destroySession(token: string) {
  await query("DELETE FROM sessions WHERE token_hash = $1", [digest(token)]);
}

/** Resolve a raw cookie token to the owning user id, or null when stale/unknown. */
export async function resolveSession(token: string | undefined) {
  if (!token) return null;

  const row = await queryOne<{ user_id: string; role: UserRole }>(
    `SELECT s.user_id, u.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()
     LIMIT 1`,
    [digest(token)]
  );

  return row ? { userId: row.user_id, role: row.role } : null;
}

/** Best-effort sweep of expired rows; failures must never break a request. */
export async function purgeExpiredSessions() {
  try {
    await query("DELETE FROM sessions WHERE expires_at <= now()");
  } catch (error) {
    console.error("[auth] session purge failed:", (error as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Cookie helpers (server-only)
// ---------------------------------------------------------------------------

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}

export async function readSessionCookie() {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}
