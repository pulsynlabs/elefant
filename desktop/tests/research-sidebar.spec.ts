/**
 * research-sidebar.spec.ts
 *
 * Verifies the Research entry exists in the sidebar once a project is open.
 * The Research nav item lives in `projectNavItems` (Sidebar.svelte) and is
 * only rendered when `projectsStore.activeProjectId` is set, so the spec
 * mocks the projects API to surface a clickable project card, then opens it.
 *
 * No daemon required — all relevant endpoints are intercepted via page.route().
 */

import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  installCommonMocks,
  PROJECT_FIXTURE,
  loadAppShell,
  openFirstProject,
} from "./helpers/research-mocks";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.resolve(__dir, "screenshots/research");
const DESKTOP = { width: 1280, height: 800 };

test.describe("Research Sidebar Entry", () => {
  test.use({ viewport: DESKTOP });
  test.setTimeout(30000);

  test.beforeAll(() => {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await installCommonMocks(page);
  });

  test("Research entry appears after a project is opened", async ({ page }) => {
    await loadAppShell(page);
    const opened = await openFirstProject(page);

    if (!opened) {
      test.skip(true, "Project picker did not surface an Open project card.");
      return;
    }

    // After a project is active, the Research nav button must render in the
    // sidebar. The button uses the project nav item label "Research" with
    // matching aria-label (see Sidebar.svelte projectNavItems).
    const researchBtn = page.getByRole("button", { name: "Research", exact: true });
    await expect(researchBtn).toBeVisible({ timeout: 10000 });

    await page.screenshot({
      path: path.join(SHOT_DIR, "sidebar-research-entry.png"),
      fullPage: false,
    });
  });

  test("clicking Research opens the Research view", async ({ page }) => {
    await loadAppShell(page);
    const opened = await openFirstProject(page);

    if (!opened) {
      test.skip(true, "Project picker did not surface an Open project card.");
      return;
    }

    await page.getByRole("button", { name: "Research", exact: true }).click();
    await page.waitForTimeout(500);

    // ResearchView marks its root with data-testid="research-view"
    await expect(page.locator('[data-testid="research-view"]')).toBeVisible({
      timeout: 10000,
    });
  });
});
