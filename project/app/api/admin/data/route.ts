import { NextResponse } from "next/server";
import { errorResponse, requireAdmin } from "@/lib/api";
import {
  listExpenses,
  listGateLogs,
  listUsersForAdmin,
  totalMembershipRevenue,
} from "@/lib/repository";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/data — everything the admin dashboard renders in one payload:
 * the user directory, the gate log feed, the expense ledger and revenue.
 */
export async function GET() {
  try {
    await requireAdmin();

    const [users, logs, expenses, revenue] = await Promise.all([
      listUsersForAdmin(),
      listGateLogs(100),
      listExpenses(),
      totalMembershipRevenue(),
    ]);

    return NextResponse.json({
      success: true,
      users,
      logs,
      expenses,
      totalRevenue: Number(revenue?.total ?? 0),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
