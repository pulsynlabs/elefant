/**
 * research-settings.spec.ts
 *
 * Verifies the Settings → Research Base tab is reachable and shows its core
 * content. Uses shared mocks so no daemon is required.
 *
 * Scope is intentionally narrow — only the entry point and a single visible
 * marker from ResearchBaseTab. Deeper behaviour (toggles, providers, hardware
 * stats) is covered by component-level tests; spec hygiene says we should
 * avoid coupling e2e to that surface area.
 */

import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  installCommonMocks,
  loadAppShell,
  openFirstProject,
} from "./helpers/research-mocks";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.resolve(__dir, "screenshots/research");
const DESKTOP = { width: 1280, height: 800 };

test.describe("Research Base settings tab", () => {
  test.use({ viewport: DESKTOP });
  test.setTimeout(30000);

  test.beforeAll(() => {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await installCommonMocks(page);
  });

  test("Research Base tab is visible and renders content", async ({ page }) => {
    await loadAppShell(page);
    // Open a project first so per-project research stats can resolve.
    await openFirstProject(page);

    // Navigate to Settings via the sidebar nav button (the only one within
    // .sidebar-nav with that label — avoids colliding with the chat header
    // Settings affordance once a project is open).
    await page
      .locator(".sidebar-nav")
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    // Settings view container appears.
    await page
      .locator(".settings-view")
      .waitFor({ state: "visible", timeout: 10000 });

    // Activate the Research Base tab. The label exactly matches the entry
    // registered in SettingsView.svelte's `sections` array.
    const researchTab = page.getByRole("button", { name: "Research Base", exact: true });
    await expect(researchTab).toBeVisible();
    await researchTab.click();
    await page.waitForTimeout(400);

    // Vector Index card heading is the first stable element rendered by
    // ResearchBaseTab. Use the heading role to avoid colliding with the
    // tab label or the "Vector Index" toggle copy.
    await expect(
      page.getByRole("heading", { name: "Vector Index", exact: true }),
    ).toBeVisible();

    await page.screenshot({
      path: path.join(SHOT_DIR, "settings-research-base.png"),
      fullPage: false,
    });
  });
});
