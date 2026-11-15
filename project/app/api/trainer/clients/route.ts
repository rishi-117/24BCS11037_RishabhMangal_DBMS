import { NextResponse } from "next/server";
import { errorResponse, requireTrainer } from "@/lib/api";
import { listMembersForTrainer } from "@/lib/repository";

export const dynamic = "force-dynamic";

/**
 * GET /api/trainer/clients — roster for the signed-in coach.
 * The trainer identity comes from the session cookie, never a query param, so
 * one coach cannot enumerate another coach's roster.
 */
export async function GET() {
  try {
    const { user } = await requireTrainer();
    const roster = await listMembersForTrainer(user.uid);
    return NextResponse.json({ success: true, ...roster });
  } catch (error) {
    return errorResponse(error);
  }
}
