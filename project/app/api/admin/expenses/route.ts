import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, parseBody, requireAdmin } from "@/lib/api";
import { addExpense } from "@/lib/repository";

export const dynamic = "force-dynamic";

const expenseSchema = z.object({
  category: z.string().trim().min(2, "Describe the expense category.").max(120),
  amount: z.coerce
    .number()
    .positive("Amount must be greater than zero.")
    .max(10_000_000, "Amount looks too large."),
});

/** POST /api/admin/data — record an operational expense. */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await parseBody(request, expenseSchema);

    const created = await addExpense(body.category, body.amount);

    return NextResponse.json(
      {
        success: true,
        id: created?.id,
        message: "Expense recorded successfully.",
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
