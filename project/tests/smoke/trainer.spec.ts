/**
 * smoke/trainer.spec.ts
 *
 * Tests for trainer routes.
 *
 * SESSION: /api/auth/me is mocked. These tests sign in as no one by default, so
 * the login pages render their own UI. The dashboard/attendance tests assert a
 * graceful redirect rather than a crash.
 *
 * Covers:
 *  ✓ Trainer login page loads with the credential sign-in form
 *  ✓ Trainer login has two tabs: sign-in and apply
 *  ✓ Trainer login "Apply as Staff" tab shows the application form
 *  ✓ Trainer dashboard loads without a JS crash (may redirect to login)
 *  ✓ Trainer attendance loads without a JS crash (may redirect)
 */

import { test, expect } from "@playwright/test";
import { mockApiRoutes, mockCamera, mockHtml5Qrcode } from "./helpers";

// Signed out: the login pages must render their own forms.
test.beforeEach(async ({ page }) => {
  await mockCamera(page);
  await mockHtml5Qrcode(page);
  await mockApiRoutes(page, { persona: "none" });
});

test("trainer login page loads with sign-in button", async ({ page }) => {
  await page.goto("/trainer/login");
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByRole("heading", { name: /coach terminal/i }).or(page.getByText(/coach terminal/i))
  ).toBeVisible({ timeout: 10_000 });

  // Credential sign-in is now the primary path (Google OAuth was removed).
  await expect(
    page.getByRole("button", { name: /sign in as coach/i })
  ).toBeVisible({ timeout: 10_000 });

  await expect(page.getByPlaceholder(/coach@example\.com/i)).toBeVisible();
});

test("trainer login has two tabs: sign-in and apply", async ({ page }) => {
  await page.goto("/trainer/login");
  await page.waitForTimeout(1000);

  await expect(page.getByRole("button", { name: /coach sign in/i })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole("button", { name: /apply as staff/i })).toBeVisible({ timeout: 5_000 });
});

test("trainer login 'Apply as Staff' tab shows application form", async ({ page }) => {
  await page.goto("/trainer/login");
  await page.waitForTimeout(1000);

  await page.getByRole("button", { name: /apply as staff/i }).click();

  await expect(page.getByRole("button", { name: /submit coach application/i })).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("select")).toBeVisible();
});

test("trainer dashboard loads without JS crash", async ({ page }) => {
  // Signed out in beforeEach: the page must redirect to the coach login without
  // throwing. (The populated dashboard is covered in the next test.)
  const errors: string[] = [];
  page.on("pageerror", (err) => {
    if (!err.message.includes("Html5")) errors.push(err.message);
  });

  await page.goto("/trainer/dashboard");
  await page.waitForURL(/\/(trainer\/dashboard|trainer\/login)$/, { timeout: 15_000 });

  expect(errors).toHaveLength(0);
  expect(page.url()).toMatch(/\/(trainer\/dashboard|trainer\/login)$/);
});

test("trainer dashboard renders the client roster when signed in", async ({ page }) => {
  await page.unroute("**/api/auth/me");
  await mockApiRoutes(page, { persona: "trainer" });

  const errors: string[] = [];
  page.on("pageerror", (err) => {
    if (!err.message.includes("Html5")) errors.push(err.message);
  });

  await page.goto("/trainer/dashboard");
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("heading", { name: /coach vikram coach/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: /my clients/i })).toBeVisible();
  await expect(page.getByText(/assigned trainees roster/i)).toBeVisible();

  expect(errors).toHaveLength(0);
});

test("trainer attendance loads without JS crash", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => {
    if (!err.message.includes("Firebase") && !err.message.includes("Html5")) {
      errors.push(err.message);
    }
  });

  await page.goto("/trainer/attendance");
  await page.waitForTimeout(3000);

  expect(errors).toHaveLength(0);
});
