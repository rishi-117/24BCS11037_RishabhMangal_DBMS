import type { MembershipSummary, PlanPayload } from "./types";

export interface MembershipPlan {
  id: string;
  name: string;
  tier: string;
  price: number;
  durationMonths: number;
  description: string;
  features: string[];
}

/**
 * Catalogue mirror of the `membership_plans` table. Client components render
 * pricing cards and the registration picker from this list so no extra round
 * trip is needed; the server always re-reads the authoritative row by `code`
 * before writing a membership or payment.
 */
export const GYM_PLANS: MembershipPlan[] = [
  {
    id: "monthly-standard",
    name: "Monthly Standard",
    tier: "Standard",
    price: 2500,
    durationMonths: 1,
    description: "Full access to weight room, cardio section, and locker rooms.",
    features: ["General Gym Access", "Cardio & Strength Zones", "Locker Room & Shower Access"],
  },
  {
    id: "quarterly-pro",
    name: "Quarterly Pro",
    tier: "Pro",
    price: 6500,
    durationMonths: 3,
    description: "Full gym access plus 1-on-1 personal trainer guidance and diet plan.",
    features: [
      "All Standard Features",
      "Assigned Dedicated Trainer",
      "Bi-weekly Body Composition Check",
      "Custom Diet Plan",
    ],
  },
  {
    id: "annual-vip",
    name: "Annual VIP Pass",
    tier: "VIP",
    price: 18000,
    durationMonths: 12,
    description: "Unlimited access, priority trainer coaching, steam bath, and guest passes.",
    features: [
      "All Pro Features",
      "Unlimited Guest Passes (2/mo)",
      "Steam & Sauna Access",
      "Priority Peak-Hour Booking",
    ],
  },
];

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const formatDay = (date: Date) =>
  date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/**
 * Interpret `YYYY-MM-DD` as local midnight.
 *
 * `new Date("2026-10-10")` parses as UTC midnight, which rolls back a day in
 * negative-offset timezones and would mis-state membership dates.
 */
function parseDate(value: string | Date): Date {
  if (value instanceof Date) return value;

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  return new Date(value);
}

/**
 * Derive the display-ready membership summary from the server-supplied plan.
 *
 * `startDate`/`endDate` are returned as Date objects because the dashboards
 * compute durations and progress bars from them.
 */
export function computeMembership(
  rawPlan: PlanPayload | null | undefined,
  createdAt?: string | Date | null
): MembershipSummary {
  const startDate = rawPlan?.startDate
    ? parseDate(rawPlan.startDate)
    : createdAt
      ? parseDate(createdAt)
      : new Date();

  // `endDate` is the last covered day (already converted from the exclusive
  // database boundary by the API), so an end date of today still counts.
  const endDate = rawPlan?.endDate
    ? parseDate(rawPlan.endDate)
    : new Date(startDate.getTime() + (Number(rawPlan?.daysLeft ?? 30) || 30) * MS_PER_DAY);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rawDays = Math.round((endDate.getTime() - today.getTime()) / MS_PER_DAY) + 1;
  const daysRemaining = Math.max(0, rawDays);

  let status: MembershipSummary["status"] = "ACTIVE";
  if (rawDays <= 0) {
    status = "EXPIRED";
  } else if (rawDays <= 7) {
    status = "EXPIRING_SOON";
  }

  return {
    status,
    daysRemaining,
    planName: rawPlan?.name || "Standard Monthly Access",
    tier: rawPlan?.tier || "Standard",
    price: rawPlan?.price ? String(rawPlan.price) : "2500",
    startDate,
    endDate,
    startDateFormatted: formatDay(startDate),
    endDateFormatted: formatDay(endDate),
    isExpired: daysRemaining <= 0,
  };
}

/** Add whole months, clamping to the last valid day (31 Jan + 1 month → 28/29 Feb). */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const targetDay = result.getDate();
  result.setMonth(result.getMonth() + months);
  if (result.getDate() < targetDay) {
    result.setDate(0);
  }
  return result;
}

/** `YYYY-MM-DD` for PostgreSQL `date` columns, in local calendar terms. */
export const toDateOnly = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
