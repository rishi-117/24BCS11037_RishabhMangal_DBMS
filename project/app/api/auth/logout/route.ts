import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, destroySession, readSessionCookie } from "@/lib/auth";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

/** POST /api/auth/logout — delete the server-side session and clear the cookie. */
export async function POST() {
  try {
    const token = await readSessionCookie();
    if (token) {
      await destroySession(token);
    }

    const store = await cookies();
    store.delete(SESSION_COOKIE);

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
