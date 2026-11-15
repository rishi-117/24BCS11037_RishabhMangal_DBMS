/** Shared shapes exchanged between the server API and the client pages. */

export type UserRole = "member" | "trainer" | "admin";
export type TrainerStatus = "pending" | "approved" | "rejected" | "revoked";
export type Presence = "IN" | "OUT";
export type MemberStatus = "ACTIVE" | "EXPIRING_SOON" | "EXPIRED";

/**
 * Serialised membership term as sent to the browser. Field names match the
 * original Firestore document (`plan.name`, `plan.price`) so the existing UI
 * keeps working unchanged.
 */
export interface PlanPayload {
  id: string;
  name: string;
  tier: string;
  price: string;
  durationMonths: number;
  startDate: string;
  endDate: string;
  daysLeft: number;
  status: MemberStatus;
}

/** Result of computeMembership — dates stay as Date objects for the UI. */
export interface MembershipSummary {
  status: MemberStatus;
  daysRemaining: number;
  planName: string;
  tier: string;
  price: string;
  startDate: Date;
  endDate: Date;
  startDateFormatted: string;
  endDateFormatted: string;
  isExpired: boolean;
}

export interface AssignedTrainer {
  uid: string;
  name: string;
  phone: string;
  email: string;
  specialization?: string;
}

/** Body of GET/POST /api/auth/me. */
export interface SessionUser {
  uid: string;
  email: string;
  name: string;
  phone: string;
  role: UserRole;
  status: string;
  specialization?: string;
  experience?: string;
  currentStatus: Presence;
  totalSessions: number;
  attendanceCount: number;
  lastActive: string | null;
  lastCheckIn: string | null;
  joiningDate: string | null;
  requestedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rating: number | null;
  trainerNotes: string;
  assignedTrainer: AssignedTrainer | null;
  plan: PlanPayload | null;
  createdAt: string | null;
}

export interface GateLogRow {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  role: "MEMBER" | "TRAINER";
  type: "CHECK-IN" | "CHECK-OUT";
  gymId: string;
  source: string;
  time: string;
  occurredAt: string;
}

export interface ExpenseRow {
  id: string;
  category: string;
  amount: string;
  dateFormatted: string;
  spentAt: string;
}

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  status: string;
  currentStatus: Presence;
  totalSessions: number;
  plan: PlanPayload | null;
  assignedTrainer: AssignedTrainer | null;
  specialization: string | null;
  experience: string | null;
  rating: number | null;
  trainerNotes: string;
  createdAt: string | null;
  requestedAt: string | null;
  lastActive: string | null;
  lastCheckIn: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  joiningDate: string | null;
}

export interface TrainerListItem {
  uid: string;
  name: string;
  email: string;
  phone: string;
  specialization: string;
  experience: string;
  status: "approved";
}

export interface ClientRow {
  id: string;
  name: string;
  phone: string;
  email: string;
  attendanceCount: number;
  isPresent: boolean;
  rating: number;
  trainerNotes: string;
  plan: PlanPayload | null;
  createdAt: string | null;
  assignedTrainer: AssignedTrainer | null;
  currentStatus: Presence;
}
