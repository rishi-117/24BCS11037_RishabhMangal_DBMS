import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — deployment smoke check.
 * Deliberately reports only reachability, never connection details.
 */
export async function GET() {
  try {
    const started = Date.now();
    await queryOne("SELECT 1 AS ok");

    return NextResponse.json({
      status: "ok",
      database: "reachable",
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[health] database check failed:", error);
    return NextResponse.json(
      { status: "error", database: "unreachable" },
      { status: 503 }
    );
  }
}
