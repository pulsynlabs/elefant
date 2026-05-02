/**
 * Multi-daemon connection management smoke tests.
 *
 * These are UI-level smoke tests against the running dev server. They avoid
 * requiring a live daemon and only verify the critical visible wiring for the
 * server-management surfaces.
 */

import { test, expect, Page } from "@playwright/test";

async function loadApp(page: Page): Promise<void> {
  await page.goto("/", { timeout: 15000, waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Toggle sidebar" })
    .waitFor({ state: "visible", timeout: 15000 });
}

async function navigateToServersSettings(page: Page): Promise<void> {
  await loadApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Servers", exact: true }).click();
}

test.describe("Servers Settings Panel", () => {
  test("Servers tab exists and is navigable", async ({ page }) => {
    await navigateToServersSettings(page);

    await expect(
      page.getByRole("button", { name: "Servers", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Configured daemon servers" })
    ).toBeVisible({ timeout: 5000 });
  });

  test("Add Server button opens the modal", async ({ page }) => {
    await navigateToServersSettings(page);

    await page.getByRole("button", { name: "Add server", exact: true }).click();

    await expect(
      page.getByRole("dialog", { name: "Add server" })
    ).toBeVisible({ timeout: 5000 });
    await expect(page.getByLabel(/URL/i)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Add server" })
    ).not.toBeVisible();
  });
});

test.describe("Connection Status", () => {
  test("Shows server name in top bar", async ({ page }) => {
    await loadApp(page);

    const statusButton = page.locator('button[aria-label^="Active server:"]');
    await expect(statusButton).toBeVisible({ timeout: 5000 });
    await expect(statusButton).toContainText(
      /.+\s—\s(Connected|Disconnected|Reconnecting)/
    );
  });
});
