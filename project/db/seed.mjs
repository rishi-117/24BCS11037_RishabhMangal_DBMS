#!/usr/bin/env node
/**
 * db/seed.mjs — demo data for the AURA Athletic Club ERP.
 *
 * Idempotent demo data. Set DEMO_PASSWORD in .env.local before running.
 * Never use demonstration accounts in a real production environment.
 *
 *   npm run db:seed
 */
import pg from "pg";
import bcrypt from "bcryptjs";

const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
if (!DEMO_PASSWORD || DEMO_PASSWORD.length < 8) {
  throw new Error("Set DEMO_PASSWORD to at least 8 characters before seeding.");
}
const ROUNDS = 12;

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")
    ? undefined
    : { rejectUnauthorized: true },
});

const daysFromNow = (days) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  // Format from local calendar parts: toISOString() would shift the day in
  // timezones behind UTC.
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const dateOnly = (offsetDays) => daysFromNow(offsetDays);

async function upsertUser({ email, username = null, name, phone, role, passwordHash }) {
  const { rows } = await client.query(
    `INSERT INTO users (email, username, name, phone, password_hash, role)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (lower(email)) DO UPDATE
       SET name = EXCLUDED.name,
           phone = EXCLUDED.phone,
           username = COALESCE(users.username, EXCLUDED.username)
     RETURNING id`,
    [email, username, name, phone, passwordHash, role]
  );
  return rows[0].id;
}

async function ensureActivity(userId, { status = "OUT", sessions = 0, lastActive = null }) {
  await client.query(
    `INSERT INTO user_activity (user_id, current_status, total_sessions, last_active, last_check_in)
     VALUES ($1, $2, $3, $4, $4)
     ON CONFLICT (user_id) DO UPDATE
       SET current_status = EXCLUDED.current_status,
           total_sessions = EXCLUDED.total_sessions,
           last_active    = EXCLUDED.last_active,
           last_check_in  = EXCLUDED.last_check_in`,
    [userId, status, sessions, lastActive]
  );
}

async function ensureMembership(userId, planId, startOffsetDays, endOffsetDays, price) {
  const existing = await client.query(
    "SELECT id FROM memberships WHERE user_id = $1 AND start_date = $2",
    [userId, dateOnly(startOffsetDays)]
  );
  if (existing.rowCount > 0) return existing.rows[0].id;

  const { rows } = await client.query(
    `INSERT INTO memberships (user_id, plan_id, start_date, end_date, price_paid)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [userId, planId, dateOnly(startOffsetDays), dateOnly(endOffsetDays), price]
  );
  return rows[0].id;
}

async function ensurePayment(userId, membershipId, amount, months, kind) {
  const existing = await client.query("SELECT id FROM payments WHERE membership_id = $1", [
    membershipId,
  ]);
  if (existing.rowCount > 0) return;

  await client.query(
    `INSERT INTO payments (user_id, membership_id, amount, months, kind)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, membershipId, amount, months, kind]
  );
}

async function ensureExpense(category, amount, offsetDays) {
  const existing = await client.query(
    "SELECT id FROM expenses WHERE category = $1 AND amount = $2",
    [category, amount]
  );
  if (existing.rowCount > 0) return;

  await client.query(
    "INSERT INTO expenses (category, amount, spent_at) VALUES ($1, $2, $3::date + time '10:00')",
    [category, amount, dateOnly(offsetDays)]
  );
}

async function ensureGateLog(userId, role, action, offsetDays, source) {
  const existing = await client.query(
    `SELECT id FROM gate_logs
     WHERE user_id = $1 AND action = $2 AND occurred_at::date = $3::date`,
    [userId, action, dateOnly(offsetDays)]
  );
  if (existing.rowCount > 0) return;

  await client.query(
    `INSERT INTO gate_logs (user_id, role, action, gym_id, source, occurred_at)
     VALUES ($1, $2, $3, 'AURA_CLUB_MAIN_ENTRANCE', $4, $5::date + time '18:30')`,
    [userId, role, action, source, dateOnly(offsetDays)]
  );
}

async function main() {
  await client.connect();
  console.log("Seeding AURA Athletic Club demo data...\n");

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, ROUNDS);

  // ---------------------------------------------------------------------------
  // Membership catalogue
  // ---------------------------------------------------------------------------
  const plans = [
    {
      code: "monthly-standard",
      name: "Monthly Standard",
      tier: "Standard",
      price: 2500,
      months: 1,
      description: "Full access to weight room, cardio section, and locker rooms.",
      features: ["General Gym Access", "Cardio & Strength Zones", "Locker Room & Shower Access"],
    },
    {
      code: "quarterly-pro",
      name: "Quarterly Pro",
      tier: "Pro",
      price: 6500,
      months: 3,
      description: "Full gym access plus 1-on-1 personal trainer guidance and diet plan.",
      features: [
        "All Standard Features",
        "Assigned Dedicated Trainer",
        "Bi-weekly Body Composition Check",
        "Custom Diet Plan",
      ],
    },
    {
      code: "annual-vip",
      name: "Annual VIP Pass",
      tier: "VIP",
      price: 18000,
      months: 12,
      description: "Unlimited access, priority trainer coaching, steam bath, and guest passes.",
      features: [
        "All Pro Features",
        "Unlimited Guest Passes (2/mo)",
        "Steam & Sauna Access",
        "Priority Peak-Hour Booking",
      ],
    },
  ];

  const planIds = {};
  for (const plan of plans) {
    const { rows } = await client.query(
      `INSERT INTO membership_plans (code, name, tier, price_inr, duration_months, description, features)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name,
             tier = EXCLUDED.tier,
             price_inr = EXCLUDED.price_inr,
             duration_months = EXCLUDED.duration_months,
             description = EXCLUDED.description,
             features = EXCLUDED.features
       RETURNING id`,
      [plan.code, plan.name, plan.tier, plan.price, plan.months, plan.description, plan.features]
    );
    planIds[plan.code] = rows[0].id;
  }
  console.log(`✓ ${plans.length} membership plans`);

  // ---------------------------------------------------------------------------
  // Administrator
  // ---------------------------------------------------------------------------
  const adminId = await upsertUser({
    email: "admin@auraclub.fit",
    username: "admin",
    name: "Club Administrator",
    phone: "+91 90000 00001",
    role: "admin",
    passwordHash,
  });
  await ensureActivity(adminId, { status: "OUT", sessions: 0 });

  // ---------------------------------------------------------------------------
  // Trainers
  // ---------------------------------------------------------------------------
  const trainerSeed = [
    {
      email: "vikram@auraclub.fit",
      name: "Vikram Singh",
      phone: "+91 98111 22334",
      specialization: "Strength & Conditioning",
      experience: "ACE Certified, 8 years experience",
      status: "approved",
    },
    {
      email: "neha@auraclub.fit",
      name: "Neha Kapoor",
      phone: "+91 98222 33445",
      specialization: "Fat Loss & Endurance",
      experience: "ISSA Certified, 5 years experience",
      status: "approved",
    },
    {
      email: "arjun@auraclub.fit",
      name: "Arjun Mehta",
      phone: "+91 98333 44556",
      specialization: "CrossFit & Functional Training",
      experience: "CrossFit L2, 4 years experience",
      status: "pending",
    },
  ];

  const trainerIds = {};
  for (const trainer of trainerSeed) {
    const id = await upsertUser({
      email: trainer.email,
      name: trainer.name,
      phone: trainer.phone,
      role: "trainer",
      passwordHash,
    });

    await client.query(
      `INSERT INTO trainer_profiles
         (user_id, specialization, experience, status, requested_at, approved_at, joining_date)
       VALUES ($1, $2, $3, $4, now(), $5, $5)
       ON CONFLICT (user_id) DO UPDATE
         SET specialization = EXCLUDED.specialization,
             experience     = EXCLUDED.experience,
             status         = EXCLUDED.status,
             approved_at    = EXCLUDED.approved_at,
             joining_date   = EXCLUDED.joining_date`,
      [
        id,
        trainer.specialization,
        trainer.experience,
        trainer.status,
        trainer.status === "approved" ? new Date() : null,
      ]
    );

    await ensureActivity(id, {
      status: trainer.email === "vikram@auraclub.fit" ? "IN" : "OUT",
      sessions: trainer.status === "approved" ? 42 : 0,
      lastActive: trainer.status === "approved" ? new Date() : null,
    });

    trainerIds[trainer.email] = id;
  }
  console.log(`✓ ${trainerSeed.length} trainer profiles`);

  // ---------------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------------
  const memberSeed = [
    {
      email: "rahul@example.com",
      name: "Rahul Sharma",
      phone: "+91 98765 43210",
      plan: "quarterly-pro",
      startOffset: -35,
      endOffset: 55,
      trainer: "vikram@auraclub.fit",
      rating: 9,
      notes: "Strong squat progression. Add one extra conditioning block per week.",
      status: "IN",
      sessions: 24,
    },
    {
      email: "priya@example.com",
      name: "Priya Nair",
      phone: "+91 99887 76655",
      plan: "annual-vip",
      startOffset: -120,
      endOffset: 245,
      trainer: "neha@auraclub.fit",
      rating: 8,
      notes: "Excellent consistency. Ready to progress to heavier compound lifts.",
      status: "OUT",
      sessions: 61,
    },
    {
      email: "karan@example.com",
      name: "Karan Verma",
      phone: "+91 98765 11122",
      plan: "monthly-standard",
      startOffset: -28,
      endOffset: 3,
      trainer: "vikram@auraclub.fit",
      rating: 7,
      notes: "Membership expiring this week. Remind about renewal at the desk.",
      status: "OUT",
      sessions: 15,
    },
    {
      email: "anjali@example.com",
      name: "Anjali Rao",
      phone: "+91 97654 32109",
      plan: "monthly-standard",
      startOffset: -60,
      endOffset: -32,
      trainer: null,
      rating: null,
      notes: "",
      status: "OUT",
      sessions: 9,
    },
    {
      email: "sameer@example.com",
      name: "Sameer Khan",
      phone: "+91 91234 56789",
      plan: "monthly-standard",
      startOffset: -41,
      endOffset: -11,
      trainer: "neha@auraclub.fit",
      rating: 6,
      notes: "Attendance dropped after injury. Schedule a reassessment.",
      status: "OUT",
      sessions: 12,
    },
    {
      email: "isha@example.com",
      name: "Isha Deshpande",
      phone: "+91 93456 78901",
      plan: "quarterly-pro",
      startOffset: -5,
      endOffset: 85,
      trainer: "vikram@auraclub.fit",
      rating: 10,
      notes: "New member with excellent baseline strength. Start progressive overload.",
      status: "IN",
      sessions: 4,
    },
  ];

  for (const member of memberSeed) {
    const id = await upsertUser({
      email: member.email,
      name: member.name,
      phone: member.phone,
      role: "member",
      passwordHash,
    });

    const plan = plans.find((p) => p.code === member.plan);

    const membershipId = await ensureMembership(
      id,
      planIds[member.plan],
      member.startOffset,
      member.endOffset,
      plan.price
    );
    await ensurePayment(id, membershipId, plan.price, plan.months, "MEMBERSHIP_PURCHASE");

    await ensureActivity(id, {
      status: member.status,
      sessions: member.sessions,
      lastActive: new Date(),
    });

    await client.query(
      `INSERT INTO member_profiles (user_id, assigned_trainer_id, rating, trainer_notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE
         SET assigned_trainer_id = EXCLUDED.assigned_trainer_id,
             rating = EXCLUDED.rating,
             trainer_notes = EXCLUDED.trainer_notes`,
      [id, member.trainer ? trainerIds[member.trainer] : null, member.rating, member.notes]
    );

    // Recent gate history so the streak calendar and log feed have content.
    for (const offset of [-2, -4, -6, -9, -13]) {
      await ensureGateLog(id, "member", "CHECK-IN", offset, "MEMBER_TERMINAL");
      await ensureGateLog(id, "member", "CHECK-OUT", offset, "MEMBER_TERMINAL");
    }
    if (member.status === "IN") {
      await ensureGateLog(id, "member", "CHECK-IN", 0, "RECEPTION_DESK");
    }
  }
  console.log(`✓ ${memberSeed.length} members with memberships, payments and gate history`);

  // ---------------------------------------------------------------------------
  // Trainer duty history
  // ---------------------------------------------------------------------------
  for (const offset of [-1, -3, -5]) {
    await ensureGateLog(trainerIds["vikram@auraclub.fit"], "trainer", "CHECK-IN", offset, "TRAINER_TERMINAL");
    await ensureGateLog(trainerIds["vikram@auraclub.fit"], "trainer", "CHECK-OUT", offset, "TRAINER_TERMINAL");
  }
  await ensureGateLog(trainerIds["vikram@auraclub.fit"], "trainer", "CHECK-IN", 0, "TRAINER_TERMINAL");

  // ---------------------------------------------------------------------------
  // Expense ledger
  // ---------------------------------------------------------------------------
  await ensureExpense("Equipment maintenance", 12500, -12);
  await ensureExpense("Electricity & utilities", 8600, -8);
  await ensureExpense("Trainer salary payout", 45000, -5);
  await ensureExpense("Cleaning supplies", 2300, -2);
  console.log("✓ 4 expense records");

  console.log("\nSeed complete. Demo accounts use the configured DEMO_PASSWORD.");
  console.log("  Admin    → admin@auraclub.fit      (or username: admin)");
  console.log("  Trainer  → vikram@auraclub.fit     (approved)");
  console.log("  Trainer  → arjun@auraclub.fit      (pending approval)");
  console.log("  Member   → rahul@example.com       (active, checked in)");
  console.log("  Member   → karan@example.com       (expiring soon)");
  console.log("  Member   → sameer@example.com      (expired)");

  await client.end();
}

main().catch(async (error) => {
  console.error("\nSeed failed:", error.message);
  await client.end().catch(() => {});
  process.exit(1);
});
