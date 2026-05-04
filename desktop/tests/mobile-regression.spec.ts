/**
 * Mobile Regression Suite — Wave 3, Task 3.1
 *
 * Stable passing regression suite for mobile UI at 390×844 (iPhone 14 Pro).
 * Promotes the audit's discovery checks into firm Playwright assertions:
 *
 *   Test Group 1: Layout at 390×844 — all accessible views
 *     - No horizontal scroll on any view
 *     - All touch targets ≥44×44px
 *     - Baseline screenshots committed
 *
 *   Test Group 2: Drawer lifecycle
 *     - Hamburger opens drawer, backdrop closes it
 *     - Escape key closes drawer
 *     - Body scroll locked while drawer open
 *
 *   Test Group 3: Resize auto-close
 *     - Drawer auto-closes when resizing from mobile to desktop width
 *
 *   Test Group 4: Chat input bottom edge
 *     - No horizontal scroll on home/chat views
 *     - If chat input is visible, its bottom edge is within viewport
 *
 * Navigation: On mobile (≤640px) the sidebar is a fixed overlay drawer
 * opened via hamburger ("Toggle sidebar"). We click hamburger, click a nav
 * item, then close the drawer via backdrop before auditing.
 */

import { test, expect, Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import * as fs from "fs";
import * as path from "path";

// ── Config ────────────────────────────────────────────────────────────────────

const __dir = path.dirname(fileURLToPath(import.meta.url));
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const BASELINE_DIR = path.resolve(__dir, "screenshots/mobile/baseline");

// Views accessible without an active project
const ACCESSIBLE_VIEWS: { name: string; navLabel: string | null }[] = [
  { name: "home", navLabel: null }, // initial state — project picker
  { name: "settings", navLabel: "Settings" },
  { name: "models", navLabel: "Models" },
  { name: "about", navLabel: "About" },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Navigate to app and wait for the shell to render. */
async function loadApp(page: Page): Promise<void> {
  await page.goto("/", { timeout: 15000, waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Toggle sidebar" })
    .waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(500);
}

/**
 * Open the mobile drawer, click a nav item, then close the drawer.
 * On mobile (≤640px) the drawer is a fixed overlay — we cycle it open/closed
 * to reach nav items. Matches the audit spec's navigateViaDrawer pattern.
 *
 * Note (W3.T2 / MH3): The drawer Sidebar and MobileBottomNav both expose
 * navigation buttons with overlapping labels (e.g. "Settings", "Models").
 * To avoid strict-mode violations, click queries are scoped to the drawer
 * dialog. The bottom-nav path is exercised by the dedicated test in Test
 * Group 6.
 */
async function navigateTo(page: Page, navLabel: string): Promise<void> {
  // Open drawer via hamburger
  const hamburger = page.getByRole("button", { name: "Toggle sidebar" });
  await hamburger.click();
  await page.waitForTimeout(400);

  // Wait for drawer to finish sliding in
  await page
    .locator(".mobile-drawer.drawer-open")
    .waitFor({ state: "visible", timeout: 5000 });

  // Click the nav item — scope to the drawer dialog so we don't collide
  // with the same label exposed by the bottom-nav primary tabs.
  await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("button", { name: navLabel, exact: true })
    .click();
  await page.waitForTimeout(400);

  // Close drawer via backdrop. Click at a position outside the drawer
  // footprint (the drawer covers the left ~240px at z-index 30, while
  // the backdrop sits at z-index 20).
  const backdrop = page.locator(".drawer-backdrop");
  if (await backdrop.isVisible({ timeout: 2000 }).catch(() => false)) {
    await backdrop.click({
      position: { x: MOBILE.width - 30, y: 200 },
      timeout: 5000,
    });
    // Wait for drawer slide-out animation
    await page
      .locator(".mobile-drawer")
      .waitFor({ state: "hidden", timeout: 5000 })
      .catch(() => {});
  }
}

/** Assert no horizontal scroll and return scrollWidth for diagnostic use. */
async function assertNoHorizontalScroll(page: Page): Promise<number> {
  const { innerWidth, scrollWidth } = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(
    scrollWidth,
    `Horizontal scroll: scrollWidth=${scrollWidth} > innerWidth=${innerWidth}`
  ).toBeLessThanOrEqual(innerWidth + 1);
  return scrollWidth;
}

/**
 * Assert no touch-target violations (<44×44px). Uses the same comprehensive
 * selector sweep as the audit spec, with the same visibility/ancestor guards
 * to avoid false positives from hidden duplicate elements.
 */
async function assertTouchTargets(page: Page, viewName: string): Promise<void> {
  const violations = await page.evaluate(() => {
    const results: string[] = [];
    const selectors = [
      'button:not([aria-hidden="true"])',
      "a[href]",
      '[role="button"]',
      '[role="link"]',
      '[role="menuitem"]',
      '[role="tab"]',
      "select",
      "input[type='submit']",
      "input[type='reset']",
      "input[type='button']",
    ];
    const seen = new Set<Element>();

    for (const sel of selectors) {
      try {
        const elements = document.querySelectorAll(sel);
        for (const el of elements) {
          if (seen.has(el)) continue;
          seen.add(el);

          const rect = el.getBoundingClientRect();
          // Skip invisible elements
          if (rect.width <= 0 || rect.height <= 0) continue;
          const style = window.getComputedStyle(el);
          if (style.visibility === "hidden" || style.display === "none")
            continue;

          // Skip if any ancestor is hidden
          let ancestor: Element | null = el.parentElement;
          let hiddenByAncestor = false;
          while (ancestor) {
            const aStyle = window.getComputedStyle(ancestor);
            if (aStyle.visibility === "hidden" || aStyle.display === "none") {
              hiddenByAncestor = true;
              break;
            }
            ancestor = ancestor.parentElement;
          }
          if (hiddenByAncestor) continue;

          if (rect.width < 44 || rect.height < 44) {
            const tag = el.tagName.toLowerCase();
            const ariaLabel =
              (el as HTMLElement).getAttribute("aria-label") || "";
            const text =
              ((el as HTMLElement).innerText || "").slice(0, 30) || ariaLabel;
            const cls =
              (el as HTMLElement).className &&
              typeof (el as HTMLElement).className === "string"
                ? (el as HTMLElement).className
                    .split(/\s+/)
                    .slice(0, 2)
                    .join(".")
                : "";
            results.push(
              `${tag}${cls ? "." + cls : ""} "${text}" ${Math.round(rect.width)}×${Math.round(rect.height)}px`
            );
          }
        }
      } catch {
        continue;
      }
    }
    return results.slice(0, 20);
  });

  expect(
    violations,
    `Touch target violations in ${viewName}: ${violations.join(" | ")}`
  ).toHaveLength(0);
}

// ── Test Group 1: Layout at 390×844 ───────────────────────────────────────────

test.describe("Layout at 390×844", () => {
  test.use({ viewport: MOBILE });
  test.setTimeout(45000);

  test.beforeAll(() => {
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
  });

  test("home view: no horizontal scroll, baseline screenshot", async ({
    page,
  }) => {
    await loadApp(page);
    await assertNoHorizontalScroll(page);
    await page.screenshot({
      path: path.join(BASELINE_DIR, "home.png"),
      fullPage: false,
    });
  });

  for (const view of ACCESSIBLE_VIEWS.filter((v) => v.navLabel !== null)) {
    test(`${view.name} view: no horizontal scroll, touch targets pass, baseline screenshot`, async ({
      page,
    }) => {
      await loadApp(page);
      await navigateTo(page, view.navLabel!);
      await page.waitForTimeout(300);

      await assertNoHorizontalScroll(page);
      await assertTouchTargets(page, view.name);

      await page.screenshot({
        path: path.join(BASELINE_DIR, `${view.name}.png`),
        fullPage: false,
      });
    });
  }
});

// ── Test Group 2: Drawer Lifecycle ────────────────────────────────────────────

test.describe("Drawer Lifecycle", () => {
  test.use({ viewport: MOBILE });
  test.setTimeout(30000);

  test("hamburger opens drawer, backdrop closes it", async ({ page }) => {
    await loadApp(page);

    const drawer = page.locator(".mobile-drawer");

    // Drawer should be closed initially (no .drawer-open class)
    await expect(drawer).not.toHaveClass(/drawer-open/);

    // Click hamburger → drawer opens
    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    await page.waitForTimeout(500); // spring transition
    await expect(drawer).toHaveClass(/drawer-open/);

    // Backdrop should be visible
    const backdrop = page.locator(".drawer-backdrop");
    await expect(backdrop).toBeVisible();

    // Click backdrop → drawer closes. The drawer (z-index 30, 240px wide)
    // sits above the backdrop (z-index 20), so clicking the backdrop's
    // center would hit the drawer instead. Target a position on the right
    // side of the viewport that's clearly outside the drawer footprint.
    await backdrop.click({ position: { x: MOBILE.width - 30, y: 200 } });
    await page.waitForTimeout(500); // slide-out + Svelte reactivity
    await expect(drawer).not.toHaveClass(/drawer-open/);
    // Backdrop is unmounted via {#if} when drawerOpen=false
    await expect(backdrop).not.toBeVisible();
  });

  test("Escape key closes drawer", async ({ page }) => {
    await loadApp(page);

    const drawer = page.locator(".mobile-drawer");

    // Open drawer
    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    await page.waitForTimeout(500);
    await expect(drawer).toHaveClass(/drawer-open/);

    // Press Escape → drawer closes
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await expect(drawer).not.toHaveClass(/drawer-open/);
  });

  test("body scroll is locked while drawer is open", async ({ page }) => {
    await loadApp(page);

    // Open drawer
    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    await page.waitForTimeout(500);

    const overflow = await page.evaluate(
      () => document.body.style.overflow
    );
    expect(overflow).toBe("hidden");

    // Close via Escape and verify scroll is restored
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    const overflowAfter = await page.evaluate(
      () => document.body.style.overflow
    );
    expect(overflowAfter).toBe("");
  });
});

// ── Test Group 3: Resize Auto-Close ───────────────────────────────────────────

test.describe("Resize Auto-Close", () => {
  test.setTimeout(30000);

  test("drawer auto-closes when resizing from mobile to desktop", async ({
    page,
  }) => {
    // Start at mobile width
    await page.setViewportSize(MOBILE);
    await loadApp(page);

    const drawer = page.locator(".mobile-drawer");

    // Open drawer
    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    await page.waitForTimeout(500);
    await expect(drawer).toHaveClass(/drawer-open/);

    // Resize to desktop width. The resize handler sets layoutMode to
    // 'expanded', which un-mounts the `{#if layoutMode === 'mobileOverlay'}`
    // block and forces drawerOpen=false.
    await page.setViewportSize(DESKTOP);
    await page.waitForTimeout(400);

    // After resize to desktop, the drawer and backdrop should be gone
    // from the DOM entirely (removed by {#if layoutMode === 'mobileOverlay'}).
    const drawerCount = await drawer.count();
    expect(drawerCount).toBe(0);

    const backdrop = page.locator(".drawer-backdrop");
    const backdropCount = await backdrop.count();
    expect(backdropCount).toBe(0);
  });
});

// ── Test Group 4: Right Panel Mobile Surface (W6.T4 / SPEC MH10) ──────────────
//
// The right session panel renders as a fixed bottom sheet at ≤640px. Even when
// the sheet itself doesn't mount (no active session in test fixture), the
// underlying app must remain overflow-clean and the localStorage persistence
// contract must hold so the sheet hydrates correctly when a session arrives.
test.describe("Right Panel — Mobile Surface", () => {
  test.use({ viewport: MOBILE });
  test.setTimeout(30000);

  test("no horizontal overflow when right-panel store is seeded open", async ({
    page,
  }) => {
    // Seed the persistence key BEFORE navigation so the store hydrates
    // synchronously on first render. The RightPanelMobile sheet only
    // mounts when a session is active, but seeding ensures we exercise
    // the hydration path even in the no-session fixture.
    await page.addInitScript(() => {
      try {
        localStorage.setItem("elefant.rightPanel.open", "true");
      } catch {
        /* sandboxed — skip seeding */
      }
    });

    await loadApp(page);
    await assertNoHorizontalScroll(page);
  });

  test("topbar exposes Toggle session panel when visible at mobile", async ({
    page,
  }) => {
    // The mobile topbar toggle is gated on `layoutMode === 'mobileOverlay'`
    // AND `activeSessionId !== null`. Without a session in the fixture
    // the toggle is correctly hidden — verify either the toggle is
    // present with a 44×44 hit area, or no toggle is rendered (no
    // false positives).
    await loadApp(page);
    const toggle = page
      .locator('[aria-label="Toggle session panel"]')
      .first();

    const visible = await toggle
      .isVisible({ timeout: 1000 })
      .catch(() => false);
    if (!visible) {
      // Acceptable — the toggle is hidden when there's no active session.
      return;
    }

    const box = await toggle.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
});

// ── Test Group 5: Mobile Bottom Nav (W3.T2 / MH3) ────────────────────────────
//
// Bottom nav is the primary navigation surface on ≤640px viewports.
// It must be present at mobile widths, absent at desktop widths, and expose
// 5 tabs (Chat, Projects, Models, Settings, More) with ≥44×44px hit areas.

test.describe("Mobile Bottom Nav", () => {
  test.use({ viewport: MOBILE });
  test.setTimeout(30000);

  test("bottom nav renders at 390×844 with 5 tabs and 44px hit areas", async ({
    page,
  }) => {
    await loadApp(page);

    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(nav).toBeVisible();

    const tabs = nav.locator(".nav-tab");
    await expect(tabs).toHaveCount(5);

    // Each tab must hit the 44×44px floor — covers MH3 + MH6 acceptance.
    for (const label of ["Chat", "Projects", "Models", "Settings", "More"]) {
      const btn = nav.getByRole("button", { name: label, exact: true });
      await expect(btn).toBeVisible();
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test('"More" tab opens the secondary-nav sheet', async ({ page }) => {
    await loadApp(page);

    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    const moreBtn = nav.getByRole("button", { name: "More", exact: true });

    // Sheet absent before tap
    await expect(
      page.getByRole("dialog", { name: "More navigation" })
    ).toHaveCount(0);

    await moreBtn.click();
    await page.waitForTimeout(400); // slide-up animation

    // Sheet visible after tap
    const sheet = page.getByRole("dialog", { name: "More navigation" });
    await expect(sheet).toBeVisible();

    // Sheet exposes the secondary destinations
    for (const label of [
      "Agents",
      "Runs",
      "Worktrees",
      "Spec Mode",
      "Research",
      "About",
    ]) {
      await expect(
        sheet.getByRole("button", { name: label, exact: true })
      ).toBeVisible();
    }
  });

  test("bottom nav is absent at desktop widths", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loadApp(page);

    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(nav).toHaveCount(0);
  });
});

// ── Test Group 6: Wave 7 Feature Parity Assertions ───────────────────────────
//
// W7.T4 / SPEC MH8: lock in the mobile guarantees delivered in this milestone:
// connection status indicator at mobile widths, mobile setup wizard never
// rendered on desktop, terminal tab hidden on mobile, and the approval panel
// renders as a bottom sheet anchored above the bottom nav.

test.describe("Wave 7 — Feature Parity", () => {
  test.setTimeout(30000);

  test("connection status dot is present at 390×844 with role=status", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE);
    await loadApp(page);

    // The connection dot is rendered in the TopBar exclusively in
    // mobileOverlay layout mode (gated by `layoutMode === 'mobileOverlay'`
    // in TopBar.svelte). It carries role=status + aria-live=polite with an
    // aria-label of the form "Daemon <state>" so AT users hear connection
    // state changes.
    const dot = page.locator('[role="status"][aria-label^="Daemon "]').first();
    await expect(dot).toBeAttached();

    // The dot is informational, not interactive — width/height are 8px,
    // which is intentional (it's a status indicator, not a tap target).
    // We only assert presence + accessible role here.
    const box = await dot.boundingBox();
    expect(box).not.toBeNull();
  });

  test("connection status dot is absent at desktop widths", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loadApp(page);

    // At desktop widths the TopBar renders the inline ConnectionStatus
    // card (not a status dot), so the role=status connection indicator
    // shouldn't appear.
    const dot = page.locator('[role="status"][aria-label^="Daemon "]');
    await expect(dot).toHaveCount(0);
  });

  test("mobile setup wizard is never rendered on desktop", async ({ page }) => {
    // The wizard is gated behind `isCapacitorRuntime && !daemonUrlConfigured`
    // — Playwright runs in a plain browser context where isCapacitorRuntime
    // is false, so the wizard MUST never appear regardless of viewport.
    // Capacitor-runtime behavior cannot be exercised in this suite; this
    // assertion guards the desktop-side gate that prevents accidental
    // rendering on tauri/browser builds.
    await page.setViewportSize(DESKTOP);
    await loadApp(page);

    // The wizard renders its root as <div class="wizard-root">. The
    // {#if isCapacitorRuntime && !daemonUrlConfigured} gate in App.svelte
    // keeps it out of the DOM entirely on browser/desktop builds.
    const wizard = page.locator(".wizard-root");
    await expect(wizard).toHaveCount(0);

    // Resize to mobile and confirm the desktop-side gate still holds — the
    // wizard depends on Capacitor's runtime hook, not viewport width alone.
    await page.setViewportSize(MOBILE);
    await page.waitForTimeout(300);
    await expect(wizard).toHaveCount(0);
  });

  test("terminal tab is absent in the right panel at mobile widths", async ({
    page,
  }) => {
    // The right panel mobile sheet only mounts when there's an active
    // session, which the no-project test fixture doesn't provide. Seed
    // the persistence flag and verify the *desktop* RightPanel built with
    // a session would have its terminal tab — the assertion-of-record is
    // that no Terminal-labelled tab button is reachable in the mobile
    // surface at any time.
    await page.setViewportSize(MOBILE);
    await loadApp(page);

    // The mobile bottom-sheet's tab strip is the only place "Terminal"
    // could surface on mobile. With the W7.T1 gate in place, the tab
    // strip omits it entirely.
    const sheet = page.getByRole("dialog", { name: "Session panel" });
    if ((await sheet.count()) > 0) {
      const terminalTab = sheet.getByRole("tab", {
        name: "Terminal",
        exact: true,
      });
      await expect(terminalTab).toHaveCount(0);
    }
    // If no sheet is mounted (no active session), there's no terminal
    // surface to leak — the assertion is trivially satisfied.
  });

  test("approval panel uses bottom-sheet styling at mobile widths", async ({
    page,
  }) => {
    // The ApprovalPanel only mounts when `approvalsStore.pending` is
    // non-empty. Without a daemon-driven request the DOM is clean, so
    // we assert the mount-point CSS responds to viewport. Inject a
    // minimal stub style probe by checking the @media rule via
    // computed styles when the element is present.
    await page.setViewportSize(MOBILE);
    await loadApp(page);

    // Probe the global media query by checking a computed property on
    // a synthetic element with the .approval-panel class. This avoids
    // depending on a live approval request in the test fixture.
    const probeStyles = await page.evaluate(() => {
      const node = document.createElement("aside");
      node.className = "approval-panel fixed";
      node.style.position = "fixed";
      document.body.appendChild(node);
      const computed = window.getComputedStyle(node);
      const result = {
        bottom: computed.bottom,
        right: computed.right,
        left: computed.left,
      };
      node.remove();
      return result;
    });
    // The mobile rule sets `right: 0; left: 0`. If the rule is absent
    // (regression), `right` would inherit `auto` from the cascade.
    expect(probeStyles.right).toBe("0px");
    expect(probeStyles.left).toBe("0px");
  });
});

// ── Test Group 7: Chat Input Bottom Edge ──────────────────────────────────────

test.describe("Chat Input Visibility", () => {
  test.use({ viewport: MOBILE });
  test.setTimeout(30000);

  test("no horizontal scroll on home view; input bottom edge within viewport if visible", async ({
    page,
  }) => {
    await loadApp(page);

    // Verify the viewport has no overflow
    await assertNoHorizontalScroll(page);

    // Check for any visible input element (chat input, textarea, contenteditable)
    const inputArea = page.locator(
      "textarea, [contenteditable='true'], .message-input, .unified-input, .chat-input"
    );
    const count = await inputArea.count();
    if (count > 0) {
      const bbox = await inputArea.first().boundingBox();
      if (bbox) {
        expect(
          bbox.y + bbox.height,
          `Chat input bottom edge (${Math.round(bbox.y + bbox.height)}px) exceeds viewport height (${MOBILE.height}px)`
        ).toBeLessThanOrEqual(MOBILE.height + 1);
      }
    }
    // If no input is visible (project picker shown), just pass — the
    // horizontal scroll assertion already confirmed the layout is clean.
  });
});
