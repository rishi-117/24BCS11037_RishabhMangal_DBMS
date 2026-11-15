/**
 * helpers.ts — shared mocks and utilities for the UI smoke tests.
 *
 * STRATEGY (post-Firebase):
 *  - The app authenticates with an httpOnly session cookie plus /api/auth/me.
 *    UI tests mock the /api/* responses at the network layer rather than faking
 *    Firebase tokens, so no database is touched.
 *  - The camera (getUserMedia) is mocked so Html5Qrcode never opens a device.
 */

import { Page, Route } from "@playwright/test";

// ── Fake payloads ───────────────────────────────────────────────────────────

export const FAKE_PLAN = {
  id: "monthly-standard",
  name: "Monthly Standard",
  tier: "Standard",
  price: "2500",
  durationMonths: 1,
  startDate: "2026-11-01",
  endDate: "2026-12-01",
  daysLeft: 16,
  status: "ACTIVE",
};

export const FAKE_MEMBER = {
  uid: "11111111-1111-4111-8111-111111111111",
  name: "Arjun Test",
  email: "arjun@test.com",
  phone: "+91 99887 76655",
  role: "member",
  status: "active",
  currentStatus: "OUT",
  totalSessions: 12,
  attendanceCount: 12,
  lastActive: null,
  lastCheckIn: null,
  joiningDate: null,
  requestedAt: null,
  approvedAt: null,
  rejectedAt: null,
  rating: 8,
  trainerNotes: "Great progress on compound lifts.",
  assignedTrainer: {
    uid: "22222222-2222-4222-8222-222222222222",
    name: "Coach Vikram",
    phone: "+91 98111 22334",
    email: "vikram@auraclub.fit",
    specialization: "Strength & Conditioning",
  },
  plan: FAKE_PLAN,
  createdAt: "2026-11-01T00:00:00.000Z",
};

export const FAKE_TRAINER = {
  uid: "33333333-3333-4333-8333-333333333333",
  name: "Vikram Coach",
  email: "vikram@auraclub.fit",
  phone: "+91 88776 65544",
  role: "trainer",
  status: "approved",
  currentStatus: "OUT",
  specialization: "Strength & Conditioning",
  experience: "5 years",
  totalSessions: 48,
  attendanceCount: 48,
  lastActive: null,
  lastCheckIn: null,
  joiningDate: "2026-01-10T00:00:00.000Z",
  requestedAt: null,
  approvedAt: "2026-01-10T00:00:00.000Z",
  rejectedAt: null,
  rating: null,
  trainerNotes: "",
  assignedTrainer: null,
  plan: null,
  createdAt: "2026-01-10T00:00:00.000Z",
};

export const FAKE_ADMIN = {
  ...FAKE_TRAINER,
  uid: "44444444-4444-4444-8444-444444444444",
  name: "Club Administrator",
  email: "admin@auraclub.fit",
  role: "admin",
  status: "active",
  specialization: undefined,
  experience: undefined,
};

export const FAKE_CLIENT = {
  id: FAKE_MEMBER.uid,
  name: FAKE_MEMBER.name,
  phone: FAKE_MEMBER.phone,
  email: FAKE_MEMBER.email,
  attendanceCount: 12,
  isPresent: false,
  rating: 8,
  trainerNotes: "Great progress on compound lifts.",
  plan: FAKE_PLAN,
  createdAt: FAKE_MEMBER.createdAt,
  assignedTrainer: FAKE_MEMBER.assignedTrainer,
  currentStatus: "OUT",
};

// ── Camera mock ─────────────────────────────────────────────────────────────

export async function mockCamera(page: Page) {
  await page.addInitScript(() => {
    const fakeStream = {
      getTracks: () => [{ stop: () => {} }],
      getVideoTracks: () => [{ stop: () => {} }],
      getAudioTracks: () => [],
    };

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async () => fakeStream,
        enumerateDevices: async () => [],
      },
      writable: true,
      configurable: true,
    });
  });
}

// ── Html5Qrcode mock ────────────────────────────────────────────────────────

export async function mockHtml5Qrcode(page: Page) {
  await page.addInitScript(() => {
    const noop = async () => {};
    const patchWhenAvailable = () => {
      const cameraWindow = window as unknown as { Html5Qrcode?: { prototype: Record<string, unknown> } };
      if (cameraWindow.Html5Qrcode) {
        const proto = cameraWindow.Html5Qrcode.prototype;
        proto.start = noop;
        proto.stop = noop;
        proto.pause = () => {};
        proto.resume = () => {};
        proto.clear = () => {};
        proto.isScanning = false;
        proto.scanFileV2 = async () => ({
          decodedText: JSON.stringify({
            gymId: "AURA_CLUB_MAIN_ENTRANCE",
            memberUid: "11111111-1111-4111-8111-111111111111",
            action: "check-in",
          }),
          result: { text: "" },
        });
      } else {
        setTimeout(patchWhenAvailable, 50);
      }
    };
    patchWhenAvailable();
  });
}

// ── Session + API mocks ─────────────────────────────────────────────────────

type Persona = "member" | "trainer" | "admin" | "none";

const PERSONA_USER = {
  member: FAKE_MEMBER,
  trainer: FAKE_TRAINER,
  admin: FAKE_ADMIN,
} as const;

export interface ApiMockOptions {
  /** Which account /api/auth/me reports as already signed in. */
  persona?: Persona;
  /**
   * Account returned by a successful POST /api/auth/login. After that call the
   * mock also reports this user from /api/auth/me, so the login form can be
   * exercised and then verified.
   */
  loginAs?: Exclude<Persona, "none">;
}

/**
 * Intercept every /api/* call the pages make and answer with realistic data.
 * Keeps the UI suite fast, deterministic and database-free.
 */
export async function mockApiRoutes(page: Page, options: ApiMockOptions = {}) {
  const { persona = "member", loginAs } = options;

  // Mutable so a successful login can flip the session for later requests.
  let currentUser: (typeof PERSONA_USER)[keyof typeof PERSONA_USER] | null =
    persona === "none" ? null : PERSONA_USER[persona];

  await page.route("**/api/auth/me", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        currentUser
          ? { authenticated: true, exists: true, user: currentUser }
          : { authenticated: false, exists: false, user: null }
      ),
    });
  });

  await page.route("**/api/auth/login", async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    const identifier = String(body.identifier ?? "");
    const password = String(body.password ?? "");

    // Deliberately wrong credentials let the UI error path be asserted.
    if (password === "wrong-password" || identifier === "wrong") {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Invalid credentials. Please check and try again." }),
      });
      return;
    }

    const signedIn = currentUser ?? (loginAs ? PERSONA_USER[loginAs] : FAKE_MEMBER);
    currentUser = signedIn;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, user: signedIn }),
    });
  });

  await page.route("**/api/auth/logout", async (route: Route) => {
    currentUser = null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true }),
    });
  });

  await page.route("**/api/auth/register", async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    const isTrainer = body.role === "trainer";
    const registered = isTrainer ? { ...FAKE_TRAINER, status: "pending" } : FAKE_MEMBER;
    currentUser = registered as typeof FAKE_MEMBER;

    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        status: isTrainer ? "pending" : "active",
        message: isTrainer ? "Application submitted." : "Welcome to AURA Athletic Club!",
        user: registered,
      }),
    });
  });

  await page.route("**/api/attendance**", async (route: Route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          activeFloorCount: 7,
          attendedDates: [Date.now() - 86_400_000, Date.now() - 2 * 86_400_000],
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          role: "member",
          currentStatus: "IN",
          totalSessions: 13,
          message: "Checked in successfully.",
        }),
      });
    }
  });

  await page.route("**/api/trainers", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        trainers: [
          {
            uid: FAKE_TRAINER.uid,
            name: FAKE_TRAINER.name,
            email: FAKE_TRAINER.email,
            phone: FAKE_TRAINER.phone,
            specialization: FAKE_TRAINER.specialization,
            experience: FAKE_TRAINER.experience,
            status: "approved",
          },
        ],
      }),
    });
  });

  await page.route("**/api/trainer/clients", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, all: [FAKE_CLIENT], assigned: [FAKE_CLIENT] }),
    });
  });

  await page.route("**/api/trainer/rate", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, message: "Rating and coaching notes saved." }),
    });
  });

  await page.route("**/api/admin/data", async (route: Route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          users: [
            {
              id: FAKE_MEMBER.uid,
              name: FAKE_MEMBER.name,
              email: FAKE_MEMBER.email,
              phone: FAKE_MEMBER.phone,
              role: "member",
              status: "active",
              currentStatus: "OUT",
              totalSessions: 12,
              plan: FAKE_PLAN,
              assignedTrainer: FAKE_MEMBER.assignedTrainer,
              specialization: null,
              experience: null,
              rating: 8,
              trainerNotes: "",
              createdAt: FAKE_MEMBER.createdAt,
              requestedAt: null,
              lastActive: null,
              lastCheckIn: null,
              approvedAt: null,
              rejectedAt: null,
              joiningDate: null,
            },
            {
              id: FAKE_TRAINER.uid,
              name: FAKE_TRAINER.name,
              email: FAKE_TRAINER.email,
              phone: FAKE_TRAINER.phone,
              role: "trainer",
              status: "approved",
              currentStatus: "OUT",
              totalSessions: 48,
              plan: null,
              assignedTrainer: null,
              specialization: FAKE_TRAINER.specialization,
              experience: FAKE_TRAINER.experience,
              rating: null,
              trainerNotes: "",
              createdAt: FAKE_TRAINER.createdAt,
              requestedAt: null,
              lastActive: null,
              lastCheckIn: null,
              approvedAt: "2026-01-10T00:00:00.000Z",
              rejectedAt: null,
              joiningDate: "2026-01-10T00:00:00.000Z",
            },
          ],
          logs: [
            {
              id: "log-1",
              userId: FAKE_MEMBER.uid,
              userName: FAKE_MEMBER.name,
              userEmail: FAKE_MEMBER.email,
              role: "MEMBER",
              type: "CHECK-IN",
              gymId: "AURA_CLUB_MAIN_ENTRANCE",
              source: "MEMBER_TERMINAL",
              time: "12 Nov, 18:30",
              occurredAt: "2026-11-12T18:30:00.000Z",
            },
          ],
          expenses: [
            {
              id: "exp-1",
              category: "Equipment maintenance",
              amount: "5000",
              dateFormatted: "10 Nov 2026",
              spentAt: "2026-11-10T10:00:00.000Z",
            },
          ],
          totalRevenue: 38500,
        }),
      });
    } else {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ success: true, id: "exp-new", message: "Expense recorded." }),
      });
    }
  });

  await page.route("**/api/admin/expenses", async (route: Route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ success: true, id: "exp-new", message: "Expense recorded." }),
    });
  });

  await page.route("**/api/admin/scan", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        action: "check-in",
        message: "Check-in recorded for Arjun Test.",
        user: {
          id: FAKE_MEMBER.uid,
          name: FAKE_MEMBER.name,
          phone: FAKE_MEMBER.phone,
          role: "member",
          newStatus: "IN",
          membership: {
            status: "ACTIVE",
            planName: FAKE_PLAN.name,
            endDateFormatted: "1 Dec 2026",
          },
        },
      }),
    });
  });

  await page.route("**/api/admin/trainer-approval", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, message: "Trainer approved." }),
    });
  });

  await page.route("**/api/admin/renew-membership", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        message: "Membership renewed. Access is valid through 15 Dec 2026.",
      }),
    });
  });
}
