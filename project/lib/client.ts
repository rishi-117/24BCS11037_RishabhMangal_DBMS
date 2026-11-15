"use client";

import type {
  AdminUserRow,
  ClientRow,
  ExpenseRow,
  GateLogRow,
  SessionUser,
  TrainerListItem,
} from "./types";

/**
 * Browser-side API helper.
 *
 * Every request carries the httpOnly session cookie automatically; there is no
 * token juggling in components and no database credential in the bundle.
 */

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      cache: "no-store",
    });
  } catch {
    throw new ApiClientError(0, "Network error. Please check your connection and try again.");
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed (${response.status})`;
    throw new ApiClientError(response.status, message);
  }

  return payload as T;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface MeResponse {
  authenticated: boolean;
  exists: boolean;
  user: SessionUser | null;
}

export const api = {
  me: () => request<MeResponse>("/api/auth/me"),

  login: (identifier: string, password: string) =>
    request<{ success: boolean; user: SessionUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password }),
    }),

  logout: () => request<{ success: boolean }>("/api/auth/logout", { method: "POST" }),

  register: (payload: {
    email: string;
    password: string;
    name: string;
    phone: string;
    role: "member" | "trainer";
    planCode?: string;
    assignedTrainerUid?: string | null;
    specialization?: string;
    experience?: string;
  }) =>
    request<{ success: boolean; status: string; message: string; user: SessionUser }>(
      "/api/auth/register",
      { method: "POST", body: JSON.stringify(payload) }
    ),

  // -------------------------------------------------------------------------
  // Attendance
  // -------------------------------------------------------------------------

  attendanceHistory: (uid?: string) =>
    request<{ success: boolean; activeFloorCount: number; attendedDates: number[] }>(
      uid ? `/api/attendance?uid=${encodeURIComponent(uid)}` : "/api/attendance"
    ),

  logAttendance: (action: "check-in" | "check-out", gymId?: string) =>
    request<{
      success: boolean;
      role: string;
      currentStatus: "IN" | "OUT";
      totalSessions?: number;
      message: string;
    }>("/api/attendance", {
      method: "POST",
      body: JSON.stringify({ action, gymId }),
    }),

  // -------------------------------------------------------------------------
  // Public directory
  // -------------------------------------------------------------------------

  trainers: () => request<{ success: boolean; trainers: TrainerListItem[] }>("/api/trainers"),

  // -------------------------------------------------------------------------
  // Trainer portal
  // -------------------------------------------------------------------------

  trainerClients: () =>
    request<{ success: boolean; all: ClientRow[]; assigned: ClientRow[] }>("/api/trainer/clients"),

  rateMember: (memberId: string, rating: number, trainerNotes: string) =>
    request<{ success: boolean; message: string }>("/api/trainer/rate", {
      method: "POST",
      body: JSON.stringify({ memberId, rating, trainerNotes }),
    }),

  // -------------------------------------------------------------------------
  // Admin
  // -------------------------------------------------------------------------

  adminData: () =>
    request<{
      success: boolean;
      users: AdminUserRow[];
      logs: GateLogRow[];
      expenses: ExpenseRow[];
      totalRevenue: number;
    }>("/api/admin/data"),

  addExpense: (category: string, amount: number) =>
    request<{ success: boolean; id: string; message: string }>("/api/admin/expenses", {
      method: "POST",
      body: JSON.stringify({ category, amount }),
    }),

  adminScan: (qrData: string, forcedAction?: "check-in" | "check-out") =>
    request<{
      success: boolean;
      action: "check-in" | "check-out";
      message: string;
      user: {
        id: string;
        name: string;
        phone: string;
        role: string;
        newStatus?: "IN" | "OUT";
        membership?: {
          status: string;
          planName: string;
          endDateFormatted: string;
        };
      };
    }>("/api/admin/scan", {
      method: "POST",
      body: JSON.stringify({ qrData, ...(forcedAction ? { forcedAction } : {}) }),
    }),

  approveTrainer: (trainerUid: string, action: "approve" | "reject" | "revoke") =>
    request<{ success: boolean; message: string }>("/api/admin/trainer-approval", {
      method: "POST",
      body: JSON.stringify({ trainerUid, action }),
    }),

  renewMembership: (memberUid: string, planCode: string) =>
    request<{ success: boolean; message: string }>("/api/admin/renew-membership", {
      method: "POST",
      body: JSON.stringify({ memberUid, planCode }),
    }),
};
