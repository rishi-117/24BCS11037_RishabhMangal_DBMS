/**
 * smoke/admin.spec.ts
 *
 * Tests for `/admin` — Admin ERP Dashboard.
 * Authentication now goes through /api/auth/login (which requires the `admin`
 * role); the API is mocked, so no database is touched.
 *
 * Covers:
 *  ✓ Login screen renders
 *  ✓ Identifier and password inputs present
 *  ✓ Wrong credentials show an error
 *  ✓ Correct credentials unlock the dashboard (tabs appear)
 *  ✓ Management tabs visible after login
 *  ✓ Admin logout returns to the login screen
 *  ✓ No page-level JS errors
 */

import { test, expect } from "@playwright/test";
import { mockApiRoutes, mockCamera, mockHtml5Qrcode } from "./helpers";

test.beforeEach(async ({ page }) => {
  await mockCamera(page);
  await mockHtml5Qrcode(page);
  // Start signed out; a successful sign-in promotes the session to administrator.
  await mockApiRoutes(page, { persona: "none", loginAs: "admin" });
});

async function doAdminLogin(page: import("@playwright/test").Page) {
  await page.goto("/admin");
  await page.waitForLoadState("networkidle");

  await page.locator("input[type='text']").first().fill("admin");
  await page.locator("input[type='password']").first().fill("test-password");
  await page.getByRole("button", { name: /sign in to erp/i }).click();

  await expect(page.getByRole("button", { name: /financial overview/i })).toBeVisible({
    timeout: 15_000,
  });
}

test("admin login page renders form", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: /aura athletic erp/i })).toBeVisible();
  await expect(page.locator("input[type='text']").first()).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("input[type='password']").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in to erp/i })).toBeVisible();
});

test("wrong credentials show error message", async ({ page }) => {
  await page.goto("/admin");
  await page.locator("input[type='text']").first().fill("wrong");
  await page.locator("input[type='password']").first().fill("wrong");
  await page.getByRole("button", { name: /sign in to erp/i }).click();

  await expect(page.getByText(/invalid credentials/i)).toBeVisible({ timeout: 10_000 });
});

test("correct credentials unlock admin dashboard", async ({ page }) => {
  await doAdminLogin(page);
  await expect(page.getByRole("button", { name: /financial overview/i })).toBeVisible();
});

test("admin dashboard shows management tabs", async ({ page }) => {
  await doAdminLogin(page);

  for (const tabName of [/financial overview/i, /live attendance/i, /members/i]) {
    await expect(page.getByRole("button", { name: tabName })).toBeVisible({ timeout: 10_000 });
  }
});

test("admin logout returns to login screen", async ({ page }) => {
  await doAdminLogin(page);

  const logoutBtn = page.locator("button[title='Sign Out']");
  await expect(logoutBtn).toBeVisible({ timeout: 8_000 });
  await logoutBtn.click();

  await expect(page.getByRole("button", { name: /sign in to erp/i })).toBeVisible({
    timeout: 10_000,
  });
});

test("admin page has no critical page errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => {
    if (!err.message.includes("Html5")) errors.push(err.message);
  });

  await page.goto("/admin");
  await page.waitForLoadState("networkidle");

  expect(errors).toHaveLength(0);
});
