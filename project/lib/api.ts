import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { readSessionCookie, resolveSession } from "./auth";
import { getUserById } from "./repository";
import type { SessionUser } from "./types";

/**
 * Small helpers shared by every route handler so status codes, payload shapes
 * and error logging stay consistent across the API.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, message, details);
export const unauthorized = (message = "Please sign in to continue.") => new ApiError(401, message);
export const forbidden = (message = "You do not have access to this resource.") =>
  new ApiError(403, message);
export const notFound = (message = "Resource not found.") => new ApiError(404, message);
export const conflict = (message: string) => new ApiError(409, message);

/** Uniform error envelope: { error: string, details?: unknown }. */
export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message, ...(error.details ? { details: error.details } : {}) },
      { status: error.status }
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "Invalid request data.",
        details: error.issues.map((issue) => ({
          field: issue.path.join(".") || "(body)",
          message: issue.message,
        })),
      },
      { status: 400 }
    );
  }

  const message = error instanceof Error ? error.message : "Unexpected server error.";
  console.error("[api] unhandled error:", error);
  return NextResponse.json({ error: message }, { status: 500 });
}

/** Parse and validate a JSON body against a zod schema. */
export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw badRequest("Request body must be valid JSON.");
  }
  return schema.parse(raw);
}

/** Convert raw strings/form fields into numbers with a clear 400 on failure. */
export function toNumber(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed)) {
    throw badRequest(`"${field}" must be a number.`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Authentication / authorisation guards
// ---------------------------------------------------------------------------

export interface AuthContext {
  user: SessionUser;
}

/** Requires a valid session cookie; returns the fully hydrated user. */
export async function requireUser(): Promise<AuthContext> {
  const token = await readSessionCookie();
  const session = await resolveSession(token);

  if (!session) {
    throw unauthorized();
  }

  const user = await getUserById(session.userId);
  if (!user) {
    throw unauthorized("Session refers to an account that no longer exists.");
  }

  return { user };
}

/** Requires a valid session whose role is `admin`. */
export async function requireAdmin(): Promise<AuthContext> {
  const context = await requireUser();
  if (context.user.role !== "admin") {
    throw forbidden("Administrator access is required.");
  }
  return context;
}

/** Requires a valid session for an approved trainer. */
export async function requireTrainer(): Promise<AuthContext> {
  const context = await requireUser();
  if (context.user.role !== "trainer") {
    throw forbidden("Trainer access is required.");
  }
  if (context.user.status !== "approved") {
    throw forbidden("Trainer account is awaiting administrator approval.");
  }
  return context;
}
