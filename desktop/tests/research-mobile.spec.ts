/**
 * research-mobile.spec.ts
 *
 * Mobile (390×844) checks for the Research View. Verifies the mobile-only
 * top bar with a Files trigger renders, that the inline tree pane is
 * hidden, and that the trigger meets the 44×44 touch-target minimum.
 *
 * Drawer-open assertions are limited to the trigger surface — the drawer
 * component itself is exercised in component-level tests.
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
const MOBILE = { width: 390, height: 844 };

test.describe("Research View — mobile", () => {
  test.use({ viewport: MOBILE });
  test.setTimeout(30000);

  test.beforeAll(() => {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await installCommonMocks(page);
  });

  test("mobile bar shows Files trigger; inline tree pane is hidden", async ({ page }) => {
    await loadAppShell(page);
    const opened = await openFirstProject(page);
    if (!opened) {
      test.skip(true, "Project picker did not surface an Open project card.");
      return;
    }

    // On mobile the sidebar is an overlay drawer — open it, click Research,
    // close via backdrop so the rest of the assertions don't fight the
    // drawer.
    const hamburger = page.getByRole("button", { name: "Toggle sidebar" });
    await hamburger.click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Research", exact: true }).click();
    await page.waitForTimeout(600);

    const backdrop = page.locator(".drawer-backdrop");
    if (await backdrop.isVisible({ timeout: 1500 }).catch(() => false)) {
      await backdrop.click({ position: { x: MOBILE.width - 30, y: 200 } });
      await page.waitForTimeout(400);
    }

    // The Research view is mounted in mobile mode (.research-view--mobile).
    const view = page.locator('[data-testid="research-view"]');
    await expect(view).toBeVisible({ timeout: 10000 });
    await expect(view).toHaveClass(/research-view--mobile/);

    // Mobile bar is rendered with the Files trigger button.
    const filesBtn = page.getByRole("button", { name: /Open research files|Files/i });
    await expect(filesBtn).toBeVisible();

    // Touch target meets WCAG 2.5.5 / project guideline (≥44×44).
    const bbox = await filesBtn.boundingBox();
    expect(bbox).not.toBeNull();
    expect(bbox!.width).toBeGreaterThanOrEqual(44);
    expect(bbox!.height).toBeGreaterThanOrEqual(44);

    // Inline tree pane is suppressed on mobile.
    const treePane = page.locator(".research-tree-pane");
    expect(await treePane.count()).toBe(0);

    await page.screenshot({
      path: path.join(SHOT_DIR, "view-mobile.png"),
      fullPage: false,
    });
  });
});
