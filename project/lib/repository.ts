import { query, queryOne, transaction } from "./db";
import { addMonths, toDateOnly } from "./membershipUtils";
import type {
  AdminUserRow,
  AssignedTrainer,
  ClientRow,
  ExpenseRow,
  GateLogRow,
  PlanPayload,
  Presence,
  SessionUser,
  TrainerListItem,
  TrainerStatus,
  UserRole,
} from "./types";

// ---------------------------------------------------------------------------
// Row shapes (snake_case, straight from PostgreSQL)
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  email: string;
  username: string | null;
  name: string;
  phone: string | null;
  role: UserRole;
  created_at: Date;
  current_status: Presence | null;
  total_sessions: number | null;
  last_active: Date | null;
  last_check_in: Date | null;
  assigned_trainer_id: string | null;
  rating: number | null;
  trainer_notes: string | null;
  specialization: string | null;
  experience: string | null;
  trainer_status: TrainerStatus | null;
  requested_at: Date | null;
  approved_at: Date | null;
  rejected_at: Date | null;
  joining_date: Date | null;
  plan_id: number | null;
  plan_code: string | null;
  plan_name: string | null;
  plan_tier: string | null;
  plan_price: string | null;
  plan_duration: number | null;
  plan_start: string | null;
  plan_end: string | null;
  coach_name: string | null;
  coach_phone: string | null;
  coach_email: string | null;
  coach_specialization: string | null;
}

/**
 * Canonical user projection. Every endpoint that returns a user goes through
 * this single query so the "latest membership wins" rule (ORDER BY end_date
 * DESC LIMIT 1 via LATERAL) is applied consistently.
 */
const USER_SELECT = `
  SELECT
    u.id,
    u.email,
    u.username,
    u.name,
    u.phone,
    u.role,
    u.created_at,
    act.current_status,
    act.total_sessions,
    act.last_active,
    act.last_check_in,
    mp.assigned_trainer_id,
    mp.rating,
    mp.trainer_notes,
    tp.specialization,
    tp.experience,
    tp.status        AS trainer_status,
    tp.requested_at,
    tp.approved_at,
    tp.rejected_at,
    tp.joining_date,
    m.plan_id,
    p.code           AS plan_code,
    p.name           AS plan_name,
    p.tier           AS plan_tier,
    m.price_paid     AS plan_price,
    p.duration_months AS plan_duration,
    m.start_date     AS plan_start,
    m.end_date       AS plan_end,
    coach.name       AS coach_name,
    coach.phone      AS coach_phone,
    coach.email      AS coach_email,
    ctp.specialization AS coach_specialization
  FROM users u
  LEFT JOIN user_activity act     ON act.user_id = u.id
  LEFT JOIN member_profiles mp    ON mp.user_id  = u.id
  LEFT JOIN trainer_profiles tp   ON tp.user_id  = u.id
  LEFT JOIN LATERAL (
    SELECT mm.id, mm.plan_id, mm.start_date, mm.end_date, mm.price_paid
    FROM memberships mm
    WHERE mm.user_id = u.id
    ORDER BY mm.end_date DESC, mm.created_at DESC
    LIMIT 1
  ) m ON true
  LEFT JOIN membership_plans p    ON p.id = m.plan_id
  LEFT JOIN users coach           ON coach.id = mp.assigned_trainer_id
  LEFT JOIN trainer_profiles ctp  ON ctp.user_id = coach.id
`;

const iso = (value: Date | string | null): string | null =>
  value ? new Date(value).toISOString() : null;

/**
 * Parse a `YYYY-MM-DD` calendar date as local midnight so day arithmetic is not
 * shifted by timezone conversion.
 */
function parseCalendarDate(value: string | Date): Date {
  if (value instanceof Date) return value;

  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function buildPlan(row: UserRow): PlanPayload | null {
  if (!row.plan_id || !row.plan_start || !row.plan_end) return null;

  const start = parseCalendarDate(row.plan_start);
  const end = parseCalendarDate(row.plan_end);

  // `end_date` is exclusive, so the last covered day is the day before.
  const lastCovered = new Date(end);
  lastCovered.setDate(lastCovered.getDate() - 1);

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const daysLeft = Math.max(
    0,
    Math.round((lastCovered.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) + 1
  );

  let status: PlanPayload["status"] = "ACTIVE";
  if (end <= now) status = "EXPIRED";
  else if (daysLeft <= 7) status = "EXPIRING_SOON";

  return {
    id: row.plan_code ?? String(row.plan_id),
    name: row.plan_name ?? "Monthly Standard",
    tier: row.plan_tier ?? "Standard",
    price: String(row.plan_price ?? "0"),
    durationMonths: row.plan_duration ?? 1,
    startDate: toDateOnly(start),
    endDate: toDateOnly(lastCovered),
    daysLeft,
    status,
  };
}

function buildAssignedTrainer(row: UserRow): AssignedTrainer | null {
  if (!row.assigned_trainer_id) return null;

  return {
    uid: row.assigned_trainer_id,
    name: row.coach_name ?? "Personal Coach",
    phone: row.coach_phone ?? "",
    email: row.coach_email ?? "",
    specialization: row.coach_specialization ?? "General Fitness",
  };
}

/** Trainer status is derived when absent: sessions recorded implies approval. */
function resolveTrainerStatus(status: TrainerStatus | null, totalSessions: number | null): TrainerStatus {
  if (status) return status;
  return (totalSessions ?? 0) > 0 ? "approved" : "pending";
}

function toSessionUser(row: UserRow): SessionUser {
  const totalSessions = Number(row.total_sessions ?? 0);

  return {
    uid: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone ?? "",
    role: row.role,
    status:
      row.role === "trainer"
        ? resolveTrainerStatus(row.trainer_status, totalSessions)
        : row.role === "admin"
          ? "active"
          : "active",
    specialization: row.specialization ?? undefined,
    experience: row.experience ?? undefined,
    currentStatus: (row.current_status ?? "OUT") as Presence,
    totalSessions,
    attendanceCount: totalSessions,
    lastActive: iso(row.last_active),
    lastCheckIn: iso(row.last_check_in),
    joiningDate: iso(row.joining_date),
    requestedAt: iso(row.requested_at),
    approvedAt: iso(row.approved_at),
    rejectedAt: iso(row.rejected_at),
    rating: row.rating,
    trainerNotes: row.trainer_notes ?? "",
    assignedTrainer: buildAssignedTrainer(row),
    plan: buildPlan(row),
    createdAt: iso(row.created_at),
  };
}

function toAdminUserRow(row: UserRow): AdminUserRow {
  const totalSessions = Number(row.total_sessions ?? 0);

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? "",
    role: row.role,
    status:
      row.role === "trainer"
        ? resolveTrainerStatus(row.trainer_status, totalSessions)
        : "active",
    currentStatus: (row.current_status ?? "OUT") as Presence,
    totalSessions,
    plan: buildPlan(row),
    assignedTrainer: buildAssignedTrainer(row),
    specialization: row.specialization,
    experience: row.experience,
    rating: row.rating,
    trainerNotes: row.trainer_notes ?? "",
    createdAt: iso(row.created_at),
    requestedAt: iso(row.requested_at),
    lastActive: iso(row.last_active),
    lastCheckIn: iso(row.last_check_in),
    approvedAt: iso(row.approved_at),
    rejectedAt: iso(row.rejected_at),
    joiningDate: iso(row.joining_date),
  };
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface CredentialsRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  password_hash: string;
}

export function findCredentialsByIdentifier(identifier: string) {
  return queryOne<CredentialsRow>(
    `SELECT id, email, name, role, password_hash
     FROM users
     WHERE lower(email) = lower($1) OR lower(username) = lower($1)
     LIMIT 1`,
    [identifier]
  );
}

export function findUserByEmail(email: string) {
  return queryOne<{ id: string; role: UserRole }>(
    "SELECT id, role FROM users WHERE lower(email) = lower($1) LIMIT 1",
    [email]
  );
}

export async function getUserById(id: string): Promise<SessionUser | null> {
  const row = await queryOne<UserRow>(`${USER_SELECT} WHERE u.id = $1`, [id]);
  return row ? toSessionUser(row) : null;
}

export async function listUsersForAdmin(): Promise<AdminUserRow[]> {
  const rows = await query<UserRow>(`${USER_SELECT} ORDER BY u.created_at DESC`);
  return rows.map(toAdminUserRow);
}

export function findUserByEmailOrPhoneOrId(identifier: string) {
  return queryOne<{ id: string }>(
    `SELECT id FROM users
     WHERE id::text = $1 OR lower(email) = lower($1) OR phone = $1
     ORDER BY created_at
     LIMIT 1`,
    [identifier]
  );
}

/** Fuzzy lookup used by the reception desk: exact, then partial name/phone/email. */
export function searchUserFuzzy(term: string) {
  return queryOne<{ id: string }>(
    `SELECT id
     FROM users
     WHERE lower(name) = lower($1)
        OR lower(name) LIKE '%' || lower($1) || '%'
        OR lower(email) LIKE '%' || lower($1) || '%'
        OR replace(coalesce(phone, ''), ' ', '') LIKE '%' || replace($1, ' ', '') || '%'
     ORDER BY
       CASE WHEN lower(name) = lower($1) THEN 0 ELSE 1 END,
       created_at
     LIMIT 1`,
    [term]
  );
}

/** Phone numbers are stored free-form; compare on digits only. */
export function findUserByPhoneDigits(digits: string) {
  if (!digits) return Promise.resolve(null);

  return queryOne<{ id: string }>(
    `SELECT id
     FROM users
     WHERE regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = $1
        OR regexp_replace(coalesce(phone, ''), '\\D', '', 'g') LIKE '%' || right($1, 10)
     ORDER BY created_at
     LIMIT 1`,
    [digits]
  );
}

export interface CreateUserInput {
  email: string;
  name: string;
  phone: string;
  passwordHash: string;
  role: UserRole;
  username?: string | null;
}

/**
 * Insert a user plus its role-specific child rows and activity counters in one
 * transaction so a half-created account is never observable.
 */
export async function createUser(input: CreateUserInput) {
  return transaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO users (email, username, name, phone, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        input.email,
        input.username ?? null,
        input.name,
        input.phone,
        input.passwordHash,
        input.role,
      ]
    );
    const userId = inserted.rows[0].id;

    await client.query("INSERT INTO user_activity (user_id) VALUES ($1)", [userId]);

    if (input.role === "member") {
      await client.query("INSERT INTO member_profiles (user_id) VALUES ($1)", [userId]);
    } else if (input.role === "trainer") {
      await client.query(
        `INSERT INTO trainer_profiles (user_id, status, requested_at)
         VALUES ($1, 'pending', now())`,
        [userId]
      );
    }

    return userId;
  });
}

export async function updateMemberProfile(
  userId: string,
  fields: { assignedTrainerId?: string | null; rating?: number; trainerNotes?: string }
) {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (fields.assignedTrainerId !== undefined) {
    params.push(fields.assignedTrainerId);
    sets.push(`assigned_trainer_id = $${params.length}`);
  }
  if (fields.rating !== undefined) {
    params.push(fields.rating);
    sets.push(`rating = $${params.length}`);
  }
  if (fields.trainerNotes !== undefined) {
    params.push(fields.trainerNotes);
    sets.push(`trainer_notes = $${params.length}`);
  }

  if (sets.length === 0) return;

  params.push(userId);
  await query(
    `UPDATE member_profiles SET ${sets.join(", ")} WHERE user_id = $${params.length}`,
    params,
  );
}

export async function setTrainerSpecialization(userId: string, specialization: string, experience: string) {
  await query(
    `UPDATE trainer_profiles
     SET specialization = $1, experience = $2
     WHERE user_id = $3`,
    [specialization, experience, userId]
  );
}

/**
 * Transition a trainer application. `approved` also stamps joining_date, and
 * clearing a prior rejection keeps the CHECK constraint satisfied.
 */
export async function setTrainerStatus(userId: string, action: "approve" | "reject" | "revoke") {
  if (action === "approve") {
    await query(
      `UPDATE trainer_profiles
       SET status = 'approved',
           approved_at = now(),
           rejected_at = NULL,
           revoked_at = NULL,
           joining_date = COALESCE(joining_date, now())
       WHERE user_id = $1`,
      [userId]
    );
  } else if (action === "reject") {
    await query(
      `UPDATE trainer_profiles
       SET status = 'rejected', rejected_at = now()
       WHERE user_id = $1`,
      [userId]
    );
  } else {
    await query(
      `UPDATE trainer_profiles
       SET status = 'revoked', revoked_at = now()
       WHERE user_id = $1`,
      [userId]
    );
  }
}

export async function listApprovedTrainers(): Promise<TrainerListItem[]> {
  const rows = await query<{
    id: string;
    name: string;
    email: string;
    phone: string | null;
    specialization: string;
    experience: string;
  }>(
    `SELECT u.id, u.name, u.email, u.phone, tp.specialization, tp.experience
     FROM users u
     JOIN trainer_profiles tp ON tp.user_id = u.id
     WHERE u.role = 'trainer' AND tp.status = 'approved'
     ORDER BY u.name`
  );

  return rows.map((row) => ({
    uid: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? "",
    specialization: row.specialization,
    experience: row.experience,
    status: "approved" as const,
  }));
}

// ---------------------------------------------------------------------------
// Membership catalogue + terms
// ---------------------------------------------------------------------------

export interface PlanRow {
  id: number;
  code: string;
  name: string;
  tier: string;
  price_inr: string;
  duration_months: number;
  description: string;
  features: string[];
}

export function getPlanByCode(code: string) {
  return queryOne<PlanRow>("SELECT * FROM membership_plans WHERE code = $1", [code]);
}

export function getPlanByName(name: string) {
  return queryOne<PlanRow>("SELECT * FROM membership_plans WHERE lower(name) = lower($1)", [name]);
}

export function listPlans() {
  return query<PlanRow>("SELECT * FROM membership_plans ORDER BY duration_months, price_inr");
}

/** Current term that still covers today (end_date is exclusive). */
export function findActiveMembership(userId: string) {
  return queryOne<{ id: string; end_date: string; plan_id: number }>(
    `SELECT id, end_date, plan_id
     FROM memberships
     WHERE user_id = $1 AND end_date > CURRENT_DATE
     ORDER BY end_date DESC
     LIMIT 1`,
    [userId]
  );
}

export function findLatestMembership(userId: string) {
  return queryOne<{ id: string; end_date: string; plan_id: number }>(
    `SELECT id, end_date, plan_id
     FROM memberships
     WHERE user_id = $1
     ORDER BY end_date DESC
     LIMIT 1`,
    [userId]
  );
}

/**
 * Create a membership term and its matching payment receipt atomically.
 * `startDate` is the first covered day; the term runs `durationMonths` later.
 */
export async function createMembershipWithPayment(input: {
  userId: string;
  plan: PlanRow;
  startDate: Date;
  kind: "MEMBERSHIP_PURCHASE" | "MEMBERSHIP_RENEWAL";
}) {
  const endDate = addMonths(input.startDate, input.plan.duration_months);

  return transaction(async (client) => {
    const membership = await client.query<{ id: string }>(
      `INSERT INTO memberships (user_id, plan_id, start_date, end_date, price_paid)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        input.userId,
        input.plan.id,
        toDateOnly(input.startDate),
        toDateOnly(endDate),
        input.plan.price_inr,
      ]
    );

    await client.query(
      `INSERT INTO payments (user_id, membership_id, amount, months, kind)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.userId,
        membership.rows[0].id,
        input.plan.price_inr,
        input.plan.duration_months,
        input.kind,
      ]
    );

    return { membershipId: membership.rows[0].id, endDate };
  });
}

/**
 * Renewal extension: start the new term on the current term's end date (which is
 * exclusive, so there is no gap in coverage) or today when the plan has lapsed,
 * then record the payment.
 */
export async function extendMembership(input: { userId: string; plan: PlanRow }) {
  const active = await findActiveMembership(input.userId);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let startDate = today;
  if (active) {
    const currentEnd = new Date(active.end_date);
    if (currentEnd > today) startDate = currentEnd;
  }

  return createMembershipWithPayment({
    userId: input.userId,
    plan: input.plan,
    startDate,
    kind: "MEMBERSHIP_RENEWAL",
  });
}

// ---------------------------------------------------------------------------
// Attendance / presence
// ---------------------------------------------------------------------------

export function getPresence(userId: string) {
  return queryOne<{ current_status: Presence; total_sessions: number }>(
    "SELECT current_status, total_sessions FROM user_activity WHERE user_id = $1",
    [userId]
  );
}

/**
 * Record a gate event and update the member/trainer counter atomically.
 * The caller has already validated membership/pending rules.
 */
export async function recordGateEvent(input: {
  userId: string;
  role: UserRole;
  action: "CHECK-IN" | "CHECK-OUT";
  gymId: string;
  source: string;
}) {
  const nextStatus: Presence = input.action === "CHECK-IN" ? "IN" : "OUT";
  const isCheckIn = input.action === "CHECK-IN";

  return transaction(async (client) => {
    const activity = await client.query<{ total_sessions: number }>(
      `UPDATE user_activity
       SET current_status = $1,
           total_sessions = total_sessions + $2,
           last_active    = now(),
           last_check_in  = CASE WHEN $2 = 1 THEN now() ELSE last_check_in END
       WHERE user_id = $3
       RETURNING total_sessions`,
      [nextStatus, isCheckIn ? 1 : 0, input.userId]
    );

    if (activity.rowCount === 0) {
      throw new Error("Activity record missing for user");
    }

    await client.query(
      `INSERT INTO gate_logs (user_id, role, action, gym_id, source)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.userId, input.role, input.action, input.gymId, input.source]
    );

    return { currentStatus: nextStatus, totalSessions: activity.rows[0].total_sessions };
  });
}

/** Check-in timestamps for the last `limit` sessions, newest first. */
export async function listAttendanceTimestamps(userId: string, limit = 60) {
  const rows = await query<{ occurred_at: Date }>(
    `SELECT occurred_at
     FROM gate_logs
     WHERE user_id = $1 AND action = 'CHECK-IN'
     ORDER BY occurred_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  return rows.map((row) => row.occurred_at.getTime());
}

export function countMembersOnFloor() {
  return queryOne<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM user_activity act
     JOIN users u ON u.id = act.user_id
     WHERE u.role = 'member' AND act.current_status = 'IN'`
  );
}

/**
 * Member roster for the trainer portal. `isPresent` is true when the member is
 * currently checked in, or was active at some point today.
 */
export async function listMembersForTrainer(
  trainerUid: string | null
): Promise<{ all: ClientRow[]; assigned: ClientRow[] }> {
  const rows = await query<UserRow>(
    `${USER_SELECT} WHERE u.role = 'member' ORDER BY u.name`
  );

  const all = rows.map((row) => {
    const totalSessions = Number(row.total_sessions ?? 0);
    const lastActiveToday =
      row.last_active !== null &&
      new Date(row.last_active).toDateString() === new Date().toDateString();

    return {
      id: row.id,
      name: row.name,
      phone: row.phone ?? "N/A",
      email: row.email,
      attendanceCount: totalSessions,
      isPresent: row.current_status === "IN" || lastActiveToday,
      rating: row.rating ?? 0,
      trainerNotes: row.trainer_notes ?? "",
      plan: buildPlan(row),
      createdAt: iso(row.created_at),
      assignedTrainer: buildAssignedTrainer(row),
      currentStatus: (row.current_status ?? "OUT") as Presence,
    } satisfies ClientRow;
  });

  const assigned = trainerUid
    ? all.filter((client) => client.assignedTrainer?.uid === trainerUid)
    : [];

  return { all, assigned };
}

// ---------------------------------------------------------------------------
// Admin data: gate logs + expenses
// ---------------------------------------------------------------------------

export async function listGateLogs(limit = 100): Promise<GateLogRow[]> {
  const rows = await query<{
    id: string;
    user_id: string;
    user_name: string;
    user_email: string;
    role: UserRole;
    action: "CHECK-IN" | "CHECK-OUT";
    gym_id: string;
    source: string;
    occurred_at: Date;
  }>(
    `SELECT g.id, g.user_id, u.name AS user_name, u.email AS user_email,
            g.role, g.action, g.gym_id, g.source, g.occurred_at
     FROM gate_logs g
     JOIN users u ON u.id = g.user_id
     ORDER BY g.occurred_at DESC
     LIMIT $1`,
    [limit]
  );

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    role: row.role === "trainer" ? "TRAINER" : "MEMBER",
    type: row.action,
    gymId: row.gym_id,
    source: row.source,
    time: row.occurred_at.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }),
    occurredAt: row.occurred_at.toISOString(),
  }));
}

export async function listExpenses(): Promise<ExpenseRow[]> {
  const rows = await query<{ id: string; category: string; amount: string; spent_at: Date }>(
    "SELECT id, category, amount, spent_at FROM expenses ORDER BY spent_at DESC"
  );

  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    amount: row.amount,
    dateFormatted: row.spent_at.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    spentAt: row.spent_at.toISOString(),
  }));
}

export async function addExpense(category: string, amount: number) {
  return queryOne<{ id: string }>(
    "INSERT INTO expenses (category, amount) VALUES ($1, $2) RETURNING id",
    [category, amount]
  );
}

/** Total collected from membership payments (the admin revenue figure). */
export function totalMembershipRevenue() {
  return queryOne<{ total: string }>(
    "SELECT COALESCE(SUM(amount), 0)::text AS total FROM payments"
  );
}
