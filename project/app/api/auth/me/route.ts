import { NextResponse } from "next/server";
import { readSessionCookie, resolveSession } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { getUserById } from "@/lib/repository";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/me — hydrate the current session user.
 *
 * Returns 200 with `authenticated: false` rather than 401 when there is no
 * session, so the landing page can render its signed-out state without treating
 * an ordinary visit as an error.
 */
export async function GET() {
  try {
    const token = await readSessionCookie();
    const session = await resolveSession(token);

    if (!session) {
      return NextResponse.json({ authenticated: false, exists: false, user: null });
    }

    const user = await getUserById(session.userId);
    if (!user) {
      return NextResponse.json({ authenticated: false, exists: false, user: null });
    }

    return NextResponse.json({ authenticated: true, exists: true, user });
  } catch (error) {
    return errorResponse(error);
  }
}
