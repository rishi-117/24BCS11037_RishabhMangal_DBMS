import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, errorResponse, forbidden, parseBody, requireUser } from "@/lib/api";
import { computeMembership } from "@/lib/membershipUtils";
import {
  countMembersOnFloor,
  getPresence,
  getUserById,
  listAttendanceTimestamps,
  recordGateEvent,
} from "@/lib/repository";

export const dynamic = "force-dynamic";

const GYM_IDS = ["AURA_CLUB_MAIN_ENTRANCE", "AURA_CLUB_FLOOR_2"] as const;

const scanSchema = z.object({
  action: z.enum(["check-in", "check-out"]),
  gymId: z.string().trim().optional(),
});

/** Accept either a bare gym id or the JSON payload embedded in a gate QR code. */
function resolveGymId(raw: string | undefined): string {
  if (!raw) return GYM_IDS[0];

  let candidate = raw.trim();
  if (candidate.startsWith("{")) {
    try {
      const parsed = JSON.parse(candidate) as { gymId?: string };
      candidate = parsed.gymId ?? candidate;
    } catch {
      candidate = GYM_IDS[0];
    }
  }

  return (GYM_IDS as readonly string[]).includes(candidate) ? candidate : GYM_IDS[0];
}

/**
 * POST /api/attendance — the signed-in member or trainer records their own gate
 * event. Membership expiry and duplicate state transitions are enforced here,
 * not in the browser.
 */
export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    const body = await parseBody(request, scanSchema);
    const gymId = resolveGymId(body.gymId);
    const presence = await getPresence(user.uid);
    const currentStatus = presence?.current_status ?? "OUT";

    if (user.role === "trainer") {
      if (user.status !== "approved") {
        throw forbidden("Trainer account is awaiting administrator approval.");
      }
      if (body.action === "check-in" && currentStatus === "IN") {
        throw badRequest("You are already checked in.");
      }
      if (body.action === "check-out" && currentStatus === "OUT") {
        throw badRequest("You are already checked out.");
      }

      const result = await recordGateEvent({
        userId: user.uid,
        role: user.role,
        action: body.action === "check-in" ? "CHECK-IN" : "CHECK-OUT",
        gymId,
        source: "TRAINER_TERMINAL",
      });

      return NextResponse.json({
        success: true,
        role: "trainer",
        currentStatus: result.currentStatus,
        message:
          body.action === "check-in"
            ? "Duty shift started successfully."
            : "Duty shift ended successfully.",
      });
    }

    if (user.role === "admin") {
      throw forbidden("Administrator accounts do not record attendance.");
    }

    // Members: an expired term blocks entry before anything is written.
    const membership = computeMembership(user.plan, user.createdAt);
    if (body.action === "check-in" && membership.status === "EXPIRED") {
      throw forbidden(
        `Access denied: your membership expired on ${membership.endDateFormatted}. Please renew at the front desk.`
      );
    }

    if (body.action === "check-in" && currentStatus === "IN") {
      throw badRequest("You are already checked in.");
    }
    if (body.action === "check-out" && currentStatus === "OUT") {
      throw badRequest("You are already checked out.");
    }

    const result = await recordGateEvent({
      userId: user.uid,
      role: user.role,
      action: body.action === "check-in" ? "CHECK-IN" : "CHECK-OUT",
      gymId,
      source: "MEMBER_TERMINAL",
    });

    return NextResponse.json({
      success: true,
      role: "member",
      totalSessions: result.totalSessions,
      currentStatus: result.currentStatus,
      message: body.action === "check-in" ? "Checked in successfully." : "Checked out successfully.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * GET /api/attendance — check-in history for the calendar streak plus the live
 * floor count. A member may only read their own history; staff may read any.
 */
export async function GET(request: Request) {
  try {
    const { user } = await requireUser();
    const { searchParams } = new URL(request.url);
    const requestedUid = searchParams.get("uid")?.trim();

    if (requestedUid && requestedUid !== user.uid && user.role === "member") {
      throw forbidden("You can only view your own attendance history.");
    }

    const targetUid = requestedUid || user.uid;
    const target = await getUserById(targetUid);

    if (!target) {
      throw badRequest("Unknown member.");
    }

    const [attendedDates, floorCount] = await Promise.all([
      listAttendanceTimestamps(targetUid, 60),
      countMembersOnFloor(),
    ]);

    return NextResponse.json({
      success: true,
      activeFloorCount: Number(floorCount?.count ?? 0),
      attendedDates,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
