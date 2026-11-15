import { NextResponse } from "next/server";
import { z } from "zod";
import { forbidden, errorResponse, notFound, parseBody, requireTrainer } from "@/lib/api";
import { updateMemberProfile } from "@/lib/repository";
import { queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

const rateSchema = z.object({
  memberId: z.string().uuid("A valid member id is required."),
  rating: z.coerce.number().int().min(1, "Rating must be between 1 and 10.").max(10),
  trainerNotes: z.string().max(2000, "Notes are too long.").optional().default(""),
});

/**
 * POST /api/trainer/rate — record a coaching score and session notes.
 * Only the member's assigned coach may write the assessment.
 */
export async function POST(request: Request) {
  try {
    const { user } = await requireTrainer();
    const body = await parseBody(request, rateSchema);

    const member = await queryOne<{ assigned_trainer_id: string | null; role: string }>(
      `SELECT mp.assigned_trainer_id, u.role
       FROM users u
       LEFT JOIN member_profiles mp ON mp.user_id = u.id
       WHERE u.id = $1`,
      [body.memberId]
    );

    if (!member || member.role !== "member") {
      throw notFound("Member not found.");
    }
    if (member.assigned_trainer_id !== user.uid) {
      throw forbidden("You can only rate members assigned to you.");
    }

    await updateMemberProfile(body.memberId, {
      rating: body.rating,
      trainerNotes: body.trainerNotes.trim(),
    });

    return NextResponse.json({
      success: true,
      message: "Rating and coaching notes saved.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
