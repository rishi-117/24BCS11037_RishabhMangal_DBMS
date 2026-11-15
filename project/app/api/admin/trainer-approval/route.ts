import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, errorResponse, notFound, parseBody, requireAdmin } from "@/lib/api";
import { queryOne } from "@/lib/db";
import { setTrainerStatus } from "@/lib/repository";

export const dynamic = "force-dynamic";

const approvalSchema = z.object({
  trainerUid: z.string().uuid("A valid trainer id is required."),
  action: z.enum(["approve", "reject", "revoke"]),
});

const MESSAGES: Record<string, string> = {
  approve: "Trainer approved. They can now access the portal and be assigned to members.",
  reject: "Trainer application rejected.",
  revoke: "Trainer access revoked.",
};

/** POST /api/admin/trainer-approval — move a coach through the review funnel. */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await parseBody(request, approvalSchema);

    const trainer = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE id = $1 AND role = 'trainer'",
      [body.trainerUid]
    );

    if (!trainer) {
      throw notFound("Trainer not found.");
    }

    await setTrainerStatus(body.trainerUid, body.action);

    return NextResponse.json({ success: true, message: MESSAGES[body.action] });
  } catch (error) {
    return errorResponse(error);
  }
}
