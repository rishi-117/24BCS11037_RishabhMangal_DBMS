import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, errorResponse, notFound, parseBody, requireAdmin } from "@/lib/api";
import {
  extendMembership,
  findUserByEmailOrPhoneOrId,
  getPlanByCode,
  getPlanByName,
} from "@/lib/repository";

export const dynamic = "force-dynamic";

const renewSchema = z.object({
  memberUid: z.string().uuid("A valid member id is required."),
  months: z.coerce.number().int().min(1).max(24).optional(),
  planCode: z.string().trim().optional(),
  planName: z.string().trim().optional(),
});

/**
 * POST /api/admin/renew-membership — extend a member's coverage.
 *
 * The term starts the day after the current term ends when the member is still
 * active (so paid time is never lost), otherwise today. The membership row and
 * the payment receipt are written in one transaction.
 */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await parseBody(request, renewSchema);

    const member = await findUserByEmailOrPhoneOrId(body.memberUid);
    if (!member) {
      throw notFound("Member not found.");
    }

    const plan =
      (body.planCode ? await getPlanByCode(body.planCode) : null) ??
      (body.planName ? await getPlanByName(body.planName) : null) ??
      (await getPlanByCode("monthly-standard"));

    if (!plan) {
      throw badRequest('Unknown membership plan. Pass a valid "planCode" or "planName".');
    }

    const { endDate } = await extendMembership({ userId: member.id, plan });

    // `end_date` is exclusive: the member is covered up to the preceding day.
    const lastCoveredDay = new Date(endDate);
    lastCoveredDay.setDate(lastCoveredDay.getDate() - 1);

    return NextResponse.json({
      success: true,
      message: `Membership renewed. Access is valid through ${lastCoveredDay.toLocaleDateString("en-IN")}.`,
      plan: {
        code: plan.code,
        name: plan.name,
        tier: plan.tier,
        price: plan.price_inr,
        months: plan.duration_months,
        validThrough: lastCoveredDay.toISOString().slice(0, 10),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
