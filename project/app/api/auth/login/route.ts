import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, sessionCookieOptions, SESSION_COOKIE, readSessionCookie, destroySession } from "@/lib/auth";
import { errorResponse, badRequest, unauthorized } from "@/lib/api";
import { findCredentialsByIdentifier, getUserById } from "@/lib/repository";
import { verifyPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Email or username is required."),
  password: z.string().min(1, "Password is required."),
});

/**
 * POST /api/auth/login — exchange credentials for an httpOnly session cookie.
 * Admin accounts sign in with `username`, members and trainers with `email`.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      throw badRequest("Enter both your email/username and password.");
    }

    const { identifier, password } = parsed.data;

    const account = await findCredentialsByIdentifier(identifier);
    // Identical message for "unknown user" and "wrong password" so the endpoint
    // cannot be used to enumerate accounts.
    if (!account) {
      throw unauthorized("Invalid credentials. Please check and try again.");
    }

    const valid = await verifyPassword(password, account.password_hash);
    if (!valid) {
      throw unauthorized("Invalid credentials. Please check and try again.");
    }

    await destroySession((await readSessionCookie()) ?? "").catch(() => undefined);

    const { token, expiresAt } = await createSession(account.id);
    const user = await getUserById(account.id);

    const response = NextResponse.json({ success: true, user });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
