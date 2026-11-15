import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { listApprovedTrainers } from "@/lib/repository";

export const dynamic = "force-dynamic";

/** GET /api/trainers — public list of approved coaches for member signup. */
export async function GET() {
  try {
    const trainers = await listApprovedTrainers();
    return NextResponse.json({ success: true, trainers });
  } catch (error) {
    return errorResponse(error);
  }
}
