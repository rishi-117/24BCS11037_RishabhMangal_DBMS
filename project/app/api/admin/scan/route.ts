import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, errorResponse, forbidden, notFound, parseBody, requireAdmin } from "@/lib/api";
import { computeMembership } from "@/lib/membershipUtils";
import {
  findUserByEmailOrPhoneOrId,
  findUserByPhoneDigits,
  getPresence,
  getUserById,
  recordGateEvent,
  searchUserFuzzy,
} from "@/lib/repository";

export const dynamic = "force-dynamic";

const GYM_IDS = ["AURA_CLUB_MAIN_ENTRANCE", "AURA_CLUB_FLOOR_2"] as const;

const scanSchema = z.object({
  qrData: z.string().trim().min(1, "Enter a member name, phone, email, ID or QR payload."),
  forcedAction: z.enum(["check-in", "check-out"]).optional(),
});

interface ParsedScan {
  uid: string | null;
  gymId: string;
  rawQuery: string;
}

/** Gate QRs embed JSON; staff can also type a name/phone/email/uid. */
function parseScanInput(input: string): ParsedScan {
  const trimmed = input.trim();
  let uid: string | null = null;
  let gymId: string = GYM_IDS[0];
  let rawQuery = trimmed;

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as {
        memberUid?: string;
        trainerUid?: string;
        uid?: string;
        gymId?: string;
      };
      uid = parsed.memberUid || parsed.trainerUid || parsed.uid || null;
      if (parsed.gymId && (GYM_IDS as readonly string[]).includes(parsed.gymId)) {
        gymId = parsed.gymId;
      }
      if (uid) rawQuery = "";
    } catch {
      rawQuery = trimmed;
    }
  }

  return { uid, gymId, rawQuery };
}

/** Resolve whatever the desk scanned/typed to a single user id. */
async function resolveTarget(parsed: ParsedScan): Promise<string | null> {
  if (parsed.uid) {
    const byId = await getUserById(parsed.uid);
    if (byId) return byId.uid;
  }

  if (!parsed.rawQuery) return null;

  const exact = await findUserByEmailOrPhoneOrId(parsed.rawQuery);
  if (exact) return exact.id;

  const digits = parsed.rawQuery.replace(/\D/g, "");
  if (digits.length >= 6) {
    const byPhone = await findUserByPhoneDigits(digits);
    if (byPhone) return byPhone.id;
  }

  const fuzzy = await searchUserFuzzy(parsed.rawQuery);
  return fuzzy?.id ?? null;
}

/**
 * POST /api/admin/scan — reception desk check-in / check-out.
 *
 * Staff auth is required. The action toggles based on current presence unless
 * `forcedAction` is supplied (used by the roster's explicit "Check Out" button).
 */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await parseBody(request, scanSchema);

    const parsed = parseScanInput(body.qrData);
    const targetUid = await resolveTarget(parsed);

    if (!targetUid) {
      throw notFound(
        `No member or coach found for "${body.qrData}". Check the name or phone number and try again.`
      );
    }

    const user = await getUserById(targetUid);
    if (!user) {
      throw notFound("That account could not be loaded.");
    }

    const presence = await getPresence(user.uid);
    const currentStatus = presence?.current_status ?? "OUT";
    const nextAction: "check-in" | "check-out" =
      body.forcedAction ?? (currentStatus === "IN" ? "check-out" : "check-in");

    // Guard against a stale toggle (double-click, repeated scans).
    if (nextAction === "check-in" && currentStatus === "IN") {
      throw badRequest(`${user.name} is already checked in.`);
    }
    if (nextAction === "check-out" && currentStatus === "OUT") {
      throw badRequest(`${user.name} is already checked out.`);
    }

    // ---------------- Members ----------------
    if (user.role === "member") {
      const membership = computeMembership(user.plan, user.createdAt);

      if (nextAction === "check-in" && membership.status === "EXPIRED") {
        return NextResponse.json(
          {
            error: `Access denied: ${user.name}'s membership expired on ${membership.endDateFormatted}. Renew the subscription before entry.`,
            user: {
              id: user.uid,
              name: user.name,
              phone: user.phone || "N/A",
              role: "member",
              membership,
            },
          },
          { status: 403 }
        );
      }

      const result = await recordGateEvent({
        userId: user.uid,
        role: user.role,
        action: nextAction === "check-in" ? "CHECK-IN" : "CHECK-OUT",
        gymId: parsed.gymId,
        source: "RECEPTION_DESK",
      });

      return NextResponse.json({
        success: true,
        action: nextAction,
        message: `${nextAction === "check-in" ? "Check-in" : "Check-out"} recorded for ${user.name}.`,
        user: {
          id: user.uid,
          name: user.name,
          phone: user.phone || "N/A",
          role: "member",
          membership,
          newStatus: result.currentStatus,
        },
      });
    }

    // ---------------- Trainers ----------------
    if (user.role === "trainer") {
      if (user.status !== "approved") {
        throw forbidden(`Access denied: coach ${user.name} is pending administrator approval.`);
      }

      const result = await recordGateEvent({
        userId: user.uid,
        role: user.role,
        action: nextAction === "check-in" ? "CHECK-IN" : "CHECK-OUT",
        gymId: parsed.gymId,
        source: "RECEPTION_DESK",
      });

      return NextResponse.json({
        success: true,
        action: nextAction,
        message: `Shift ${nextAction === "check-in" ? "clock-in" : "clock-out"} recorded for coach ${user.name}.`,
        user: {
          id: user.uid,
          name: user.name,
          phone: user.phone || "N/A",
          role: "trainer",
          newStatus: result.currentStatus,
        },
      });
    }

    throw badRequest("Administrator accounts cannot be checked in at the gate.");
  } catch (error) {
    return errorResponse(error);
  }
}
