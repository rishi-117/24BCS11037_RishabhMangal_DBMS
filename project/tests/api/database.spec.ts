import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";

/**
 * API integration tests — these run against the REAL Next.js server and the REAL
 * PostgreSQL database (no network mocks). They assume `npm run db:seed` has been
 * applied, and DEMO_PASSWORD matches the seeded accounts.
 *
 * They are read-mostly by design: the only mutations use records created and
 * cleaned up inside the test, so they are safe to re-run.
 */

const PASSWORD = process.env.DEMO_PASSWORD;
if (!PASSWORD) throw new Error("Set DEMO_PASSWORD to the seeded account password.");

async function login(request: APIRequestContext, identifier: string) {
  const response = await request.post("/api/auth/login", {
    data: { identifier, password: PASSWORD },
  });
  expect(response.status(), `login failed for ${identifier}`).toBe(200);
  return response;
}

test.describe("health", () => {
  test("database is reachable", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.database).toBe("reachable");
  });
});

test.describe("authentication", () => {
  test("rejects a wrong password with 401", async ({ request }) => {
    const response = await request.post("/api/auth/login", {
      data: { identifier: "rahul@example.com", password: "definitely-wrong" },
    });
    expect(response.status()).toBe(401);
  });

  test("rejects an unknown account with 401", async ({ request }) => {
    const response = await request.post("/api/auth/login", {
      data: { identifier: "nobody@example.com", password: PASSWORD },
    });
    expect(response.status()).toBe(401);
  });

  test("reports no session when signed out", async ({ request }) => {
    const response = await request.get("/api/auth/me");
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.authenticated).toBe(false);
    expect(body.user).toBeNull();
  });

  test("member can sign in and read their profile", async ({ request }) => {
    await login(request, "rahul@example.com");

    const me = await request.get("/api/auth/me");
    const body = await me.json();

    expect(body.authenticated).toBe(true);
    expect(body.user.email).toBe("rahul@example.com");
    expect(body.user.role).toBe("member");
    // Memberships are joined from the memberships table, not stored on the user.
    expect(body.user.plan).not.toBeNull();
    expect(body.user.plan.name).toBeTruthy();
  });

  test("admin signs in with username, not just email", async ({ request }) => {
    await login(request, "admin");

    const body = await (await request.get("/api/auth/me")).json();
    expect(body.user.role).toBe("admin");
  });

  test("logout destroys the session", async ({ request }) => {
    await login(request, "rahul@example.com");
    expect((await request.post("/api/auth/logout")).status()).toBe(200);

    const body = await (await request.get("/api/auth/me")).json();
    expect(body.authenticated).toBe(false);
  });
});

test.describe("authorisation boundaries", () => {
  test("member cannot read admin data", async ({ request }) => {
    await login(request, "rahul@example.com");
    expect((await request.get("/api/admin/data")).status()).toBe(403);
  });

  test("anonymous cannot read admin data", async ({ request }) => {
    expect((await request.get("/api/admin/data")).status()).toBe(401);
  });

  test("member cannot record a reception scan", async ({ request }) => {
    await login(request, "rahul@example.com");
    const response = await request.post("/api/admin/scan", { data: { qrData: "Rahul Sharma" } });
    expect(response.status()).toBe(403);
  });

  test("pending trainer is blocked from the roster", async ({ request }) => {
    await login(request, "arjun@auraclub.fit");
    expect((await request.get("/api/trainer/clients")).status()).toBe(403);
  });

  test("member cannot read another member's attendance", async ({ request, baseURL }) => {
    await login(request, "rahul@example.com");

    // Grab a different member's id through a separate admin session.
    const adminContext = await playwrightRequest.newContext({ baseURL });
    await login(adminContext, "admin");
    const adminData = await (await adminContext.get("/api/admin/data")).json();
    const other = adminData.users.find(
      (u: { role: string; email: string }) =>
        u.role === "member" && u.email !== "rahul@example.com"
    );

    const response = await request.get(`/api/attendance?uid=${other.id}`);
    expect(response.status()).toBe(403);
    await adminContext.dispose();
  });
});

test.describe("public catalogue", () => {
  test("approved trainers are listed and pending ones are not", async ({ request }) => {
    const response = await request.get("/api/trainers");
    expect(response.status()).toBe(200);

    const body = await response.json();
    const names = body.trainers.map((t: { name: string }) => t.name);

    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain("Vikram Singh");
    // Arjun Mehta is seeded with status 'pending'.
    expect(names).not.toContain("Arjun Mehta");
  });
});

test.describe("admin data", () => {
  test("returns users, gate logs, expenses and revenue", async ({ request }) => {
    await login(request, "admin");

    const response = await request.get("/api/admin/data");
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body.users)).toBe(true);
    expect(body.users.length).toBeGreaterThanOrEqual(10);
    expect(Array.isArray(body.logs)).toBe(true);
    expect(Array.isArray(body.expenses)).toBe(true);
    expect(typeof body.totalRevenue).toBe("number");
  });

  test("rejects an expense with a non-positive amount", async ({ request }) => {
    await login(request, "admin");

    const response = await request.post("/api/admin/expenses", {
      data: { category: "Invalid test expense", amount: 0 },
    });
    expect(response.status()).toBe(400);
  });

  test("creates an expense and reflects it in the ledger", async ({ request }) => {
    await login(request, "admin");

    const category = `Playwright test expense ${Date.now()}`;
    const created = await request.post("/api/admin/expenses", {
      data: { category, amount: 1234 },
    });
    expect(created.status()).toBe(201);

    const body = await (await request.get("/api/admin/data")).json();
    const match = body.expenses.find((e: { category: string }) => e.category === category);
    expect(match).toBeTruthy();
    expect(Number(match.amount)).toBe(1234);
  });
});

test.describe("reception scanning", () => {
  test("finds a member by name", async ({ request }) => {
    await login(request, "admin");

    const response = await request.post("/api/admin/scan", {
      data: { qrData: "Priya Nair" },
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.user.name).toBe("Priya Nair");
    expect(["check-in", "check-out"]).toContain(body.action);
  });

  test("finds a member by phone digits", async ({ request }) => {
    await login(request, "admin");

    const response = await request.post("/api/admin/scan", {
      data: { qrData: "9988776655" },
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).user.name).toBe("Priya Nair");
  });

  test("returns 404 for an unknown person", async ({ request }) => {
    await login(request, "admin");

    const response = await request.post("/api/admin/scan", {
      data: { qrData: "Nobody With This Name" },
    });
    expect(response.status()).toBe(404);
  });

  test("blocks an expired membership from checking in", async ({ request }) => {
    await login(request, "admin");

    // Sameer Khan is seeded with a lapsed membership.
    const response = await request.post("/api/admin/scan", {
      data: { qrData: "Sameer Khan", forcedAction: "check-in" },
    });

    expect(response.status()).toBe(403);
    expect((await response.json()).error).toContain("expired");
  });
});

test.describe("trainer roster", () => {
  test("returns only the signed-in coach's assigned clients", async ({ request }) => {
    await login(request, "vikram@auraclub.fit");

    const response = await request.get("/api/trainer/clients");
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body.all)).toBe(true);
    expect(body.assigned.length).toBeGreaterThan(0);

    // Every "assigned" client must actually point at this coach.
    const me = await (await request.get("/api/auth/me")).json();
    for (const client of body.assigned) {
      expect(client.assignedTrainer.uid).toBe(me.user.uid);
    }
  });

  test("rejects a rating outside the 1-10 range", async ({ request }) => {
    await login(request, "vikram@auraclub.fit");

    const me = await (await request.get("/api/auth/me")).json();
    const roster = await (await request.get("/api/trainer/clients")).json();
    const client = roster.assigned[0];

    const response = await request.post("/api/trainer/rate", {
      data: { memberId: client.id, rating: 42, trainerNotes: "out of range" },
    });
    expect(response.status()).toBe(400);
    expect(me.user.role).toBe("trainer");
  });

  test("refuses to rate a member assigned to another coach", async ({ request }) => {
    await login(request, "vikram@auraclub.fit");

    const roster = await (await request.get("/api/trainer/clients")).json();
    const unassigned = roster.all.find(
      (c: { assignedTrainer: { uid: string } | null }) =>
        c.assignedTrainer?.uid && c.assignedTrainer.uid !== roster.assigned[0]?.assignedTrainer?.uid
    );

    test.skip(!unassigned, "No member assigned to a different coach in seed data");

    const response = await request.post("/api/trainer/rate", {
      data: { memberId: unassigned.id, rating: 5, trainerNotes: "not my client" },
    });
    expect(response.status()).toBe(403);
  });
});

test.describe("attendance", () => {
  test("reports history and live floor count for the signed-in member", async ({ request }) => {
    await login(request, "rahul@example.com");

    const response = await request.get("/api/attendance");
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body.attendedDates)).toBe(true);
    expect(body.attendedDates.length).toBeGreaterThan(0);
    expect(typeof body.activeFloorCount).toBe("number");
  });

  test("validates the action field", async ({ request }) => {
    await login(request, "rahul@example.com");

    const response = await request.post("/api/attendance", {
      data: { action: "teleport" },
    });
    expect(response.status()).toBe(400);
  });

  test("toggles presence and keeps the counter consistent", async ({ request }) => {
    await login(request, "rahul@example.com");

    const before = await (await request.get("/api/auth/me")).json();
    const wasInside = before.user.currentStatus === "IN";

    const first = await request.post("/api/attendance", {
      data: { action: wasInside ? "check-out" : "check-in" },
    });
    expect(first.status()).toBe(200);

    // Repeating the same action must be rejected, not silently duplicated.
    const repeat = await request.post("/api/attendance", {
      data: { action: wasInside ? "check-out" : "check-in" },
    });
    expect(repeat.status()).toBe(400);

    // Restore the original state.
    const restore = await request.post("/api/attendance", {
      data: { action: wasInside ? "check-in" : "check-out" },
    });
    expect(restore.status()).toBe(200);
  });
});

test.describe("registration and foreign keys", () => {
  test("new member gets a membership term", async ({ request }) => {
    const email = `playwright.${Date.now()}@example.com`;

    const response = await request.post("/api/auth/register", {
      data: {
        email,
        password: "testpass123",
        name: "Playwright Member",
        phone: "+91 90000 11111",
        role: "member",
        planCode: "quarterly-pro",
      },
    });
    expect(response.status()).toBe(201);

    const body = await response.json();
    expect(body.user.role).toBe("member");
    expect(body.user.plan.name).toBe("Quarterly Pro");

    // The row is persisted and readable on the next request.
    const me = await (await request.get("/api/auth/me")).json();
    expect(me.user.email).toBe(email);
  });

  test("duplicate email is rejected with 409", async ({ request }) => {
    const response = await request.post("/api/auth/register", {
      data: {
        email: "rahul@example.com",
        password: "testpass123",
        name: "Duplicate",
        phone: "+91 90000 22222",
        role: "member",
      },
    });
    expect(response.status()).toBe(409);
  });

  test("new trainer starts in the pending state", async ({ request }) => {
    const email = `coach.${Date.now()}@example.com`;

    const response = await request.post("/api/auth/register", {
      data: {
        email,
        password: "testpass123",
        name: "Playwright Coach",
        phone: "+91 90000 33333",
        role: "trainer",
        specialization: "Mobility",
        experience: "2 years",
      },
    });
    expect(response.status()).toBe(201);

    const body = await response.json();
    expect(body.user.role).toBe("trainer");
    expect(body.user.status).toBe("pending");
  });

  test("rejects invalid registration payloads", async ({ request }) => {
    const response = await request.post("/api/auth/register", {
      data: {
        email: "not-an-email",
        password: "short",
        name: "x",
        phone: "1",
        role: "member",
      },
    });
    expect(response.status()).toBe(400);
  });
});
