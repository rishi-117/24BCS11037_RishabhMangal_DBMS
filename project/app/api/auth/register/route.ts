import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, hashPassword, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { badRequest, conflict, errorResponse, parseBody } from "@/lib/api";
import {
  createMembershipWithPayment,
  createUser,
  findActiveMembership,
  findUserByEmail,
  getPlanByCode,
  getPlanByName,
  getUserById,
  setTrainerSpecialization,
  updateMemberProfile,
} from "@/lib/repository";

export const dynamic = "force-dynamic";

const registerSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  name: z.string().trim().min(2, "Please enter your full name."),
  phone: z.string().trim().min(6, "Please enter a contact number."),
  role: z.enum(["member", "trainer"]),
  planCode: z.string().trim().optional(),
  assignedTrainerUid: z.string().uuid().nullable().optional(),
  specialization: z.string().trim().optional(),
  experience: z.string().trim().optional(),
});

/**
 * POST /api/auth/register — self-service signup.
 *
 * Members get an immediately active membership term (the old app treated
 * registration as a paid subscription); trainers enter the `pending` approval
 * queue. Everything happens in one transaction so a failed plan lookup cannot
 * leave an account without a membership.
 */
export async function POST(request: Request) {
  try {
    const body = await parseBody(request, registerSchema);
    const email = body.email.toLowerCase();

    const existing = await findUserByEmail(email);
    if (existing) {
      throw conflict("An account with this email already exists. Please sign in instead.");
    }

    const passwordHash = await hashPassword(body.password);

    const userId = await createUser({
      email,
      name: body.name,
      phone: body.phone,
      passwordHash,
      role: body.role,
    });

    if (body.role === "member") {
      const plan =
        (await getPlanByCode(body.planCode ?? "")) ?? (await getPlanByName("Monthly Standard"));

      if (!plan) {
        throw badRequest("Selected membership plan is not available.");
      }

      const startDate = new Date();
      startDate.setHours(0, 0, 0, 0);

      await createMembershipWithPayment({
        userId,
        plan,
        startDate,
        kind: "MEMBERSHIP_PURCHASE",
      });

      if (body.assignedTrainerUid) {
        const trainer = await getUserById(body.assignedTrainerUid);
        if (!trainer || trainer.role !== "trainer" || trainer.status !== "approved") {
          throw badRequest("Selected coach is not available or not yet approved.");
        }
        await updateMemberProfile(userId, { assignedTrainerId: trainer.uid });
      }
    } else {
      await setTrainerSpecialization(
        userId,
        body.specialization || "General Fitness",
        body.experience || "Certified Trainer"
      );
    }

    const { token, expiresAt } = await createSession(userId);
    const user = await getUserById(userId);

    const response = NextResponse.json(
      {
        success: true,
        status: body.role === "trainer" ? "pending" : "active",
        message:
          body.role === "trainer"
            ? "Application submitted. An administrator must approve your coach account."
            : "Welcome to AURA Athletic Club! Your membership is active.",
        user,
      },
      { status: 201 }
    );
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
