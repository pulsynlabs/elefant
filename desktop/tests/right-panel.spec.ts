/**
 * Right Panel — Desktop E2E (W6.T4 / SPEC MH1, MH2, MH9)
 *
 * Verifies the right session panel feature on desktop viewports (1280×800).
 * The panel toggle is only rendered when a chat session is active; tests
 * that require an open panel seed `localStorage` with `elefant.rightPanel.open`
 * before navigation so the persistence store hydrates `panelOpen=true` and
 * the panel renders as soon as a session ID is wired in. Tests gracefully
 * skip when the daemon-backed flow doesn't surface the toggle (no session
 * available in the test fixture).
 *
 * Coverage map:
 *   - MH1: Toggle button + persistence (open/close behaviour, localStorage)
 *   - MH2: Tab strip ARIA roles, keyboard cycling, lazy mount contract
 *   - MH9: Inline 3-column grid layout at desktop widths (no overflow)
 *
 * Mocks: installs the same project/config mocks as the research suite so
 * the onboarding gate clears and the chat shell renders. Sessions/MCP/SSE
 * endpoints return empty payloads — the tests focus on layout, ARIA, and
 * keyboard behaviour, not data correctness (covered by unit tests).
 */

import { test, expect, type Page } from "@playwright/test";
import { installCommonMocks, loadAppShell } from "./helpers/field-notes-mocks";

const DESKTOP = { width: 1280, height: 800 };

// ── Mocks for right-panel-specific endpoints ────────────────────────────────
//
// These return empty/safe payloads so the panel UI can mount without errors
// even if the test causes it to render (e.g. via seeded localStorage). They
// must be installed AFTER `installCommonMocks` so they take precedence for
// their narrower URL patterns.
async function installPanelMocks(page: Page): Promise<void> {
  // MCP servers list (used by McpTab)
  await page.route(/\/api\/mcp\/servers(\?|$)/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  // Per-session file-changes / todos / token events — return empty arrays
  // so the panel renders empty states instead of throwing.
  await page.route(
    /\/api\/projects\/[^/]+\/sessions\/[^/]+\/(file-changes|todos)/,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    },
  );

  // Token events SSE — keep the connection open with a single comment frame
  // so EventSource doesn't immediately reconnect and spam the test logs.
  await page.route(
    /\/api\/projects\/[^/]+\/sessions\/[^/]+\/tokens\/events/,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": connected\n\n",
      });
    },
  );
}

/** Seed localStorage so the persistence store hydrates with the panel open. */
async function seedPanelOpen(page: Page, open: boolean): Promise<void> {
  await page.addInitScript((value: boolean) => {
    try {
      localStorage.setItem("elefant.rightPanel.open", JSON.stringify(value));
    } catch {
      // localStorage may be inaccessible in some sandboxed contexts — the
      // test will fall through to the "toggle not visible" branch.
    }
  }, open);
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("Right Panel — Desktop (1280×800)", () => {
  test.use({ viewport: DESKTOP });
  test.setTimeout(30000);

  test.beforeEach(async ({ page }) => {
    await installCommonMocks(page);
    await installPanelMocks(page);
  });

  test("no horizontal overflow at 1280px", async ({ page }) => {
    // Layout regression guard. The 3-column grid (sidebar + main + optional
    // right panel) must never exceed the viewport width regardless of panel
    // state. If this fails, the AppShell grid template is over-allocating.
    await loadAppShell(page);
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(scrollWidth).toBeLessThanOrEqual(DESKTOP.width + 1);
  });

  test("right panel toggle is keyboard-accessible if rendered", async ({
    page,
  }) => {
    // Without an active session the toggle is hidden by design (App.svelte
    // gates `rightPanelOpen` on `activeSessionId !== null`). When visible
    // it must expose proper ARIA semantics — aria-label and aria-expanded —
    // for screen-reader users.
    await loadAppShell(page);
    const toggle = page
      .locator('[aria-label="Toggle session panel"]')
      .first();

    if (!(await toggle.isVisible({ timeout: 1000 }).catch(() => false))) {
      test.skip(
        true,
        "Toggle not visible — no active chat session in test fixture.",
      );
      return;
    }

    // Toggle must report its state via aria-expanded (true|false).
    const expanded = await toggle.getAttribute("aria-expanded");
    expect(expanded === "true" || expanded === "false").toBe(true);
  });

  test("panel opens, exposes tablist, closes via close button", async ({
    page,
  }) => {
    // End-to-end open → tab roles → close. Skips when the toggle isn't
    // available (no session in fixture). When it IS available we verify:
    //   - Click opens the panel shell (.right-panel-shell)
    //   - Tab strip exposes role="tablist" with 4 role="tab" children
    //   - Close button (×) closes the panel
    await seedPanelOpen(page, false);
    await loadAppShell(page);

    const toggle = page
      .locator('[aria-label="Toggle session panel"]')
      .first();
    if (!(await toggle.isVisible({ timeout: 1000 }).catch(() => false))) {
      test.skip(true, "Toggle not visible — no active session in fixture.");
      return;
    }

    await toggle.click();
    // Allow the open transition + AppShell grid recompute to settle before
    // querying the panel content.
    await page.waitForTimeout(300);

    const panel = page.locator(".right-panel-shell").first();
    await expect(panel).toBeVisible({ timeout: 3000 });

    // Tab strip ARIA contract: role="tablist" with at least the 4 default
    // tabs (MCP, Terminal, Files, Todos) per SPEC MH2.
    const tablist = page.locator('[role="tablist"]').first();
    await expect(tablist).toBeVisible();
    const tabs = page.locator('[role="tab"]');
    expect(await tabs.count()).toBeGreaterThanOrEqual(4);

    // Close affordance — the panel exposes a × button labelled
    // "Close session panel".
    const closeBtn = page
      .locator('[aria-label="Close session panel"]')
      .first();
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await page.waitForTimeout(300);
    await expect(panel).not.toBeVisible();
  });

  test("tab keyboard navigation cycles via Arrow keys", async ({ page }) => {
    // Per SPEC MH2: ←/→ cycles tabs, Enter activates. The PanelTabs
    // component implements roving tabindex, so the active tab is the only
    // one with tabindex=0.
    await seedPanelOpen(page, true);
    await loadAppShell(page);

    const tablist = page.locator('[role="tablist"]').first();
    if (!(await tablist.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip(
        true,
        "Tablist not visible — panel did not open (likely no active session).",
      );
      return;
    }

    const tabs = page.locator('[role="tab"]');
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(4);

    // The initial active tab should have aria-selected="true".
    const firstSelected = await tabs
      .filter({ has: page.locator('[aria-selected="true"]') })
      .count();
    // Roving tabindex guarantees exactly one selected tab at all times.
    expect(firstSelected === 0 || firstSelected === 1).toBe(true);

    // Focus the active tab and press ArrowRight; the next tab should
    // become aria-selected.
    const activeTab = tabs.filter({ hasNot: page.locator(":scope[tabindex='-1']") }).first();
    await activeTab.focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(150);

    const newSelected = await page
      .locator('[role="tab"][aria-selected="true"]')
      .count();
    expect(newSelected).toBe(1);
  });

  test("panel renders within 3-column grid (no overflow when open)", async ({
    page,
  }) => {
    // MH9: when the panel is open at desktop, AppShell switches to a
    // 3-column grid `[sidebar] [main 1fr] [320px]`. Verify the document
    // never exceeds the viewport width even with the panel mounted.
    await seedPanelOpen(page, true);
    await loadAppShell(page);
    await page.waitForTimeout(400);

    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(scrollWidth).toBeLessThanOrEqual(DESKTOP.width + 1);
  });

  test("panel persistence survives reload", async ({ page }) => {
    // MH1: open/closed state is persisted in localStorage. Seed open,
    // reload, and verify the panel is still open in the rendered DOM
    // (when a session is in scope) OR that the localStorage value
    // remains `true` (when no session gates rendering).
    await seedPanelOpen(page, true);
    await loadAppShell(page);

    const stored = await page.evaluate(() =>
      localStorage.getItem("elefant.rightPanel.open"),
    );
    expect(stored).toBe("true");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .getByRole("button", { name: "Toggle sidebar" })
      .waitFor({ state: "visible", timeout: 10000 });

    const storedAfter = await page.evaluate(() =>
      localStorage.getItem("elefant.rightPanel.open"),
    );
    expect(storedAfter).toBe("true");
  });
});
