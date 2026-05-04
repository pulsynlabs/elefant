/**
 * Mobile UI Audit — Wave 2, Task 2.1
 *
 * Discovers horizontal-scroll, off-viewport, and touch-target violations across
 * every accessible view at 390×844 (iPhone 14 Pro). Generates a structured
 * markdown report that drives Tasks 2.2 and 2.3.
 *
 * Views that require an active project are attempted but skipped if no project
 * is set up in the test environment. The report documents all skips.
 *
 * Navigation: The app uses Svelte 5 client-side routing controlled by a
 * navigation store. On mobile (≤640px) the sidebar is a fixed overlay drawer
 * opened via hamburger. We click the hamburger, click a nav item, then close
 * the drawer via backdrop before auditing.
 */

import { test, Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import * as fs from "fs";
import * as path from "path";

// ── Config ────────────────────────────────────────────────────────────────────

const __dir = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const SCREENSHOT_DIR = path.resolve(__dir, "screenshots/mobile");
const REPORT_PATH = path.resolve(__dir, "mobile-audit-report.md");

// Views accessible without an active project
const SIMPLE_VIEWS = [
  { name: "home", navAriaLabel: null }, // initial state — project picker
  { name: "settings", navAriaLabel: "Settings" },
  { name: "models", navAriaLabel: "Models" },
  { name: "about", navAriaLabel: "About" },
];

// Views requiring an active project — attempted but skipped if unavailable
const PROJECT_VIEWS = [
  { name: "agent-config", navAriaLabel: "Agent Config" },
  { name: "agent-runs", navAriaLabel: "Runs" },
  { name: "spec-mode", navAriaLabel: "Spec" },
  { name: "worktrees", navAriaLabel: "Worktrees" },
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface ViewResult {
  view: string;
  screenshotPath: string;
  horizontalScroll: boolean;
  offViewportElements: string[];
  touchTargetViolations: string[];
  skipped: boolean;
  skipReason?: string;
  error?: string;
}

// ── Page helpers ──────────────────────────────────────────────────────────────

/** Navigate to the app and wait for it to be interactive.
 *  Avoids `networkidle` because the daemon maintains persistent
 *  WebSocket / polling connections that never resolve it. */
async function loadApp(page: Page, timeout = 15000): Promise<void> {
  await page.goto("/", { timeout, waitUntil: "domcontentloaded" });
  // Wait for the app shell to be rendered (TopBar hamburger is a reliable landmark)
  await page.getByRole("button", { name: "Toggle sidebar" }).waitFor({ state: "visible", timeout });
  // Give the runes $effect / store initialization a moment to settle
  await page.waitForTimeout(500);
}

/** Open the mobile drawer, navigate to a view, then close the drawer.
 *  On mobile (≤640px) the drawer is a fixed overlay — we must cycle
 *  it open/closed to reach nav items.
 *
 *  Note: the bottom-nav (W3) exposes the same nav labels (Settings,
 *  Models, etc.) as the drawer's sidebar, so a top-level
 *  `getByRole("button", { name })` would resolve to two elements and
 *  throw a strict-mode violation. Scope the click to the drawer
 *  dialog so only the drawer copy is targeted. */
async function navigateViaDrawer(page: Page, navAriaLabel: string): Promise<void> {
  // Open the drawer
  const hamburger = page.getByRole("button", { name: "Toggle sidebar" });
  await hamburger.click();
  await page.waitForTimeout(400); // drawer slide-in

  // Verify drawer is open
  await page.locator(".mobile-drawer.drawer-open").waitFor({ state: "visible", timeout: 5000 });

  // Click the nav item — scoped to the drawer dialog so the bottom-nav
  // copy of the same label doesn't trigger a strict-mode collision.
  await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("button", { name: navAriaLabel, exact: true })
    .click();
  await page.waitForTimeout(400); // navigation $effect

  // Close the drawer via backdrop. Use force:true because Playwright's
  // actionability checks may wait indefinitely on the fade-in animation.
  const backdrop = page.locator(".drawer-backdrop");
  if (await backdrop.isVisible({ timeout: 2000 }).catch(() => false)) {
    await backdrop.click({ force: true, timeout: 5000 });
    // Wait for drawer to slide out and be fully hidden
    await page.locator(".mobile-drawer").waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }
}

/** Check if a project-dependent nav item is available. */
async function isNavItemAvailable(page: Page, ariaLabel: string): Promise<boolean> {
  // Open drawer first so we can see nav items
  const hamburger = page.getByRole("button", { name: "Toggle sidebar" });
  await hamburger.click();
  await page.waitForTimeout(400);
  await page.locator(".mobile-drawer.drawer-open").waitFor({ state: "visible", timeout: 5000 });

  // Scope to the drawer dialog so this query only sees the sidebar's
  // copy of the nav label (the bottom-nav doesn't render project-only
  // destinations like agent-config / worktrees, but scoping is still
  // the safer pattern and stays consistent with navigateViaDrawer above).
  const visible = await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("button", { name: ariaLabel, exact: true })
    .isVisible()
    .catch(() => false);

  // Close drawer
  const backdrop = page.locator(".drawer-backdrop");
  if (await backdrop.isVisible({ timeout: 2000 }).catch(() => false)) {
    await backdrop.click({ force: true, timeout: 5000 });
    await page.locator(".mobile-drawer").waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }

  return visible;
}

// ── Audit helpers ─────────────────────────────────────────────────────────────

async function auditView(
  page: Page,
  viewName: string
): Promise<Omit<ViewResult, "screenshotPath" | "skipped" | "skipReason" | "error">> {
  // 1. Check for horizontal scroll
  const horizontalScroll = await page.evaluate(() => {
    return document.documentElement.scrollWidth > window.innerWidth;
  });

  // 2. Check for off-viewport elements (fixed/absolute beyond viewport).
  //    Skip elements that are aria-hidden="true" — these are decorative
  //    (e.g. blurred gradient orbs) that intentionally overflow for visual
  //    effect, are not user-reachable, and don't cause horizontal scroll
  //    because their containers clip them. Their viewport overflow is
  //    irrelevant for mobile accessibility.
  const offViewportElements = await page.evaluate(() => {
    const violations: string[] = [];
    const elements = document.querySelectorAll("*");
    for (const el of elements) {
      // Skip decorative elements that are explicitly hidden from AT.
      if (el.getAttribute("aria-hidden") === "true") continue;
      // Also skip if any ancestor is aria-hidden — the entire subtree
      // is decorative in that case (e.g. an aria-hidden wrapper).
      let ancestor: Element | null = el.parentElement;
      let hiddenByAncestor = false;
      while (ancestor) {
        if (ancestor.getAttribute("aria-hidden") === "true") {
          hiddenByAncestor = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (hiddenByAncestor) continue;

      const style = window.getComputedStyle(el);
      if (style.position === "fixed" || style.position === "absolute") {
        const rect = el.getBoundingClientRect();
        if (
          rect.right > window.innerWidth + 2 ||
          rect.bottom > window.innerHeight + 2
        ) {
          const id = el.id ? `#${el.id}` : "";
          const cls =
            el.className && typeof el.className === "string"
              ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}`
              : "";
          violations.push(
            `${el.tagName.toLowerCase()}${id}${cls} (right:${Math.round(rect.right)}, bottom:${Math.round(rect.bottom)})`
          );
        }
      }
    }
    if (document.documentElement.scrollWidth > window.innerWidth) {
      violations.push(
        `document body scrollWidth=${document.documentElement.scrollWidth} > innerWidth=${window.innerWidth}`
      );
    }
    return violations.slice(0, 10);
  });

  // 3. Check touch targets for key interactive elements (Apple HIG ≥44×44px)
  const touchTargetViolations = await page.evaluate(() => {
    const violations: string[] = [];
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
          // Skip elements that aren't actually visible / tappable. A
          // zero-width column collapsed via CSS (e.g. the inline sidebar
          // aside in mobile-overlay mode) reports width=0 but a non-zero
          // height — counting it would flag invisible duplicates of the
          // drawer copy that IS visible. Combined visibility check covers
          // display:none, visibility:hidden, and zero-dimension cases.
          if (rect.width <= 0 || rect.height <= 0) continue;
          const style = window.getComputedStyle(el);
          if (style.visibility === "hidden" || style.display === "none") continue;
          // Also skip if any ancestor sets visibility:hidden (the inline
          // sidebar aside hides the whole subtree).
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
            violations.push(
              `${tag}${cls ? "." + cls : ""} "${text}" ${Math.round(rect.width)}×${Math.round(rect.height)}px`
            );
          }
        }
      } catch {
        continue;
      }
    }
    return violations.slice(0, 20);
  });

  return {
    view: viewName,
    horizontalScroll,
    offViewportElements,
    touchTargetViolations,
  };
}

// ── Report generator ──────────────────────────────────────────────────────────

function generateReport(results: ViewResult[]): string {
  const lines = [
    "# Mobile Audit Report",
    "",
    `**Generated:** ${new Date().toISOString()}`,
    `**Viewport:** 390×844 (iPhone 14 Pro)`,
    `**Audited:** ${results.length} views`,
    "",
    "---",
    "",
  ];

  for (const result of results) {
    lines.push(`## View: ${result.view}`);

    if (result.skipped) {
      lines.push(`**Status:** SKIPPED — ${result.skipReason || "unknown reason"}`);
    } else if (result.error) {
      lines.push(`**Status:** ERROR — ${result.error}`);
    } else {
      const hasOverflow =
        result.horizontalScroll || result.offViewportElements.length > 0;
      const hasTouchViolations = result.touchTargetViolations.length > 0;
      const overall = hasOverflow || hasTouchViolations ? "FAIL" : "PASS";

      lines.push(`**Status:** ${overall}`);
      lines.push(`**Screenshot:** ${result.screenshotPath || "(not captured)"}`);
      lines.push(
        `**Horizontal Scroll:** ${result.horizontalScroll ? "❌ YES (FAIL)" : "✓ No"}`
      );

      if (result.offViewportElements.length > 0) {
        lines.push(`**Off-Viewport Elements (${result.offViewportElements.length}):**`);
        result.offViewportElements.forEach((el) => lines.push(`  - ${el}`));
      } else {
        lines.push(`**Off-Viewport Elements:** ✓ None`);
      }

      if (result.touchTargetViolations.length > 0) {
        lines.push(
          `**Touch Target Violations < 44×44px (${result.touchTargetViolations.length}):**`
        );
        result.touchTargetViolations.forEach((el) => lines.push(`  - ${el}`));
      } else {
        lines.push(`**Touch Targets:** ✓ All measured targets ≥ 44×44px`);
      }
    }
    lines.push("");
  }

  // Summary table
  const total = results.length;
  const skipped = results.filter((r) => r.skipped).length;
  const audited = results.filter((r) => !r.skipped);
  const passed = audited.filter(
    (r) =>
      !r.horizontalScroll &&
      r.offViewportElements.length === 0 &&
      r.touchTargetViolations.length === 0
  ).length;
  const failed = audited.length - passed;

  lines.push("---");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("|--------|-------|");
  lines.push(`| Total views | ${total} |`);
  lines.push(`| Audited | ${audited.length} |`);
  lines.push(`| Passed | ${passed} |`);
  lines.push(`| Failed | ${failed} |`);
  lines.push(`| Skipped | ${skipped} |`);
  lines.push("");

  if (failed > 0) {
    lines.push("### Failed Views");
    lines.push("");
    for (const r of audited) {
      if (
        r.horizontalScroll ||
        r.offViewportElements.length > 0 ||
        r.touchTargetViolations.length > 0
      ) {
        lines.push(`- **${r.view}**`);
        if (r.horizontalScroll) lines.push("  - Horizontal scroll detected");
        if (r.offViewportElements.length > 0)
          lines.push(`  - ${r.offViewportElements.length} off-viewport elements`);
        if (r.touchTargetViolations.length > 0)
          lines.push(`  - ${r.touchTargetViolations.length} touch-target violations`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Test suite ────────────────────────────────────────────────────────────────

test.describe("Mobile Audit — 390×844", () => {
  test.use({ viewport: MOBILE_VIEWPORT });
  test.setTimeout(45000); // 45s per test — generous for animations + audit eval

  const results: ViewResult[] = [];

  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  // ── Reachability guard ──────────────────────────────────────────────────

  test("reachability check", async ({ page }) => {
    try {
      await page.goto("/", { timeout: 10000, waitUntil: "domcontentloaded" });
      await page
        .getByRole("button", { name: "Toggle sidebar" })
        .waitFor({ state: "visible", timeout: 10000 });
      console.log("[AUDIT] Dev server reachable — proceeding with audit");
    } catch {
      for (const view of [...SIMPLE_VIEWS, ...PROJECT_VIEWS]) {
        results.push({
          view: view.name,
          screenshotPath: "",
          horizontalScroll: false,
          offViewportElements: [],
          touchTargetViolations: [],
          skipped: true,
          skipReason: "Dev server not reachable",
        });
      }
      const report = generateReport(results);
      fs.writeFileSync(REPORT_PATH, report, "utf-8");
      console.log(`[AUDIT] Skipped report written to ${REPORT_PATH}`);
      test.skip();
    }
  });

  // ── Home view ────────────────────────────────────────────────────────────

  test("audit: home view (project picker)", async ({ page }) => {
    await loadApp(page);

    const filePath = path.join(SCREENSHOT_DIR, "home.png");
    await page.screenshot({ path: filePath, fullPage: false });

    const data = await auditView(page, "home");
    results.push({
      ...data,
      screenshotPath: path.relative(process.cwd(), filePath),
      skipped: false,
    });

    if (data.horizontalScroll)
      console.warn("[AUDIT] home: horizontal scroll detected");
    data.offViewportElements.forEach((el) =>
      console.warn(`[AUDIT] home: off-viewport: ${el}`)
    );
    data.touchTargetViolations.forEach((el) =>
      console.warn(`[AUDIT] home: touch-target: ${el}`)
    );
  });

  // ── Simple views (no project required) ──────────────────────────────────

  for (const view of SIMPLE_VIEWS.filter((v) => v.navAriaLabel !== null)) {
    test(`audit: ${view.name} view`, async ({ page }) => {
      await loadApp(page);

      try {
        await navigateViaDrawer(page, view.navAriaLabel!);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        results.push({
          view: view.name,
          screenshotPath: "",
          horizontalScroll: false,
          offViewportElements: [],
          touchTargetViolations: [],
          skipped: true,
          skipReason: `Drawer navigation failed: ${message}`,
        });
        test.skip();
        return;
      }

      // Wait for the view content to appear after navigation
      await page.waitForTimeout(500);

      const filePath = path.join(SCREENSHOT_DIR, `${view.name}.png`);
      await page.screenshot({ path: filePath, fullPage: false });

      const data = await auditView(page, view.name);
      results.push({
        ...data,
        screenshotPath: path.relative(process.cwd(), filePath),
        skipped: false,
      });

      if (data.horizontalScroll)
        console.warn(`[AUDIT] ${view.name}: horizontal scroll detected`);
      data.offViewportElements.forEach((el) =>
        console.warn(`[AUDIT] ${view.name}: off-viewport: ${el}`)
      );
      data.touchTargetViolations.forEach((el) =>
        console.warn(`[AUDIT] ${view.name}: touch-target: ${el}`)
      );
    });
  }

  // ── Project-dependent views ─────────────────────────────────────────────

  for (const view of PROJECT_VIEWS) {
    test(`audit: ${view.name} view (project-dependent)`, async ({ page }) => {
      await loadApp(page);

      const available = await isNavItemAvailable(page, view.navAriaLabel!);
      if (!available) {
        results.push({
          view: view.name,
          screenshotPath: "",
          horizontalScroll: false,
          offViewportElements: [],
          touchTargetViolations: [],
          skipped: true,
          skipReason:
            "No active project — nav item hidden (open a project first)",
        });
        test.skip();
        return;
      }

      try {
        await navigateViaDrawer(page, view.navAriaLabel!);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        results.push({
          view: view.name,
          screenshotPath: "",
          horizontalScroll: false,
          offViewportElements: [],
          touchTargetViolations: [],
          skipped: true,
          skipReason: `Drawer navigation failed: ${message}`,
        });
        test.skip();
        return;
      }

      await page.waitForTimeout(500);

      const filePath = path.join(SCREENSHOT_DIR, `${view.name}.png`);
      await page.screenshot({ path: filePath, fullPage: false });

      const data = await auditView(page, view.name);
      results.push({
        ...data,
        screenshotPath: path.relative(process.cwd(), filePath),
        skipped: false,
      });

      if (data.horizontalScroll)
        console.warn(`[AUDIT] ${view.name}: horizontal scroll detected`);
    });
  }

  // ── Right panel seeded-open view (W6.T4) ────────────────────────────────
  //
  // Audits the home view with `elefant.rightPanel.open=true` seeded into
  // localStorage so the RightPanelMobile bottom sheet hydrates as soon as
  // a session is in scope. Even when the sheet itself doesn't mount (no
  // session in fixture), this catches any layout regression introduced by
  // the persistence-store hydration path on mobile.
  test("audit: right-panel-seeded view", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("elefant.rightPanel.open", "true");
      } catch {
        /* sandboxed — skip seeding */
      }
    });
    await loadApp(page);

    const filePath = path.join(SCREENSHOT_DIR, "right-panel-seeded.png");
    await page.screenshot({ path: filePath, fullPage: false });

    const data = await auditView(page, "right-panel-seeded");
    results.push({
      ...data,
      screenshotPath: path.relative(process.cwd(), filePath),
      skipped: false,
    });

    if (data.horizontalScroll)
      console.warn(
        "[AUDIT] right-panel-seeded: horizontal scroll detected",
      );
    data.offViewportElements.forEach((el) =>
      console.warn(`[AUDIT] right-panel-seeded: off-viewport: ${el}`),
    );
    data.touchTargetViolations.forEach((el) =>
      console.warn(`[AUDIT] right-panel-seeded: touch-target: ${el}`),
    );
  });

  // ── Report generation (always runs) ─────────────────────────────────────

  test("generate audit report", async () => {
    const report = generateReport(results);
    fs.writeFileSync(REPORT_PATH, report, "utf-8");
    console.log(`[AUDIT] Report written to ${REPORT_PATH}`);

    const total = results.length;
    const skipped = results.filter((r) => r.skipped).length;
    const audited = results.filter((r) => !r.skipped);
    const passed = audited.filter(
      (r) =>
        !r.horizontalScroll &&
        r.offViewportElements.length === 0 &&
        r.touchTargetViolations.length === 0
    ).length;
    const failed = audited.length - passed;

    console.log(
      `[AUDIT] Total: ${total}, Audited: ${audited.length}, Passed: ${passed}, Failed: ${failed}, Skipped: ${skipped}`
    );

    if (failed > 0) {
      console.log("[AUDIT] Failed views:");
      for (const r of audited) {
        if (
          r.horizontalScroll ||
          r.offViewportElements.length > 0 ||
          r.touchTargetViolations.length > 0
        ) {
          console.log(`  - ${r.view}`);
        }
      }
    }
  });
});
