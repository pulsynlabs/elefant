/**
 * Shared route mocks and navigation helpers for the Research Base spec suite.
 *
 * The desktop app talks to a daemon over HTTP. The Vite dev server proxies
 * `/api/*`, `/health`, `/v1/research/*` to the daemon at localhost:1337.
 * For e2e tests we don't run the daemon — instead each spec installs route
 * fulfillers via page.route() so the UI sees a coherent project + config.
 *
 * Mock surface:
 *   - /api/health         → ok
 *   - /api/config         → masked config with one provider (passes the
 *                           "real provider" gate in App.svelte → main UI)
 *   - /api/projects       → array of one project (note: NOT wrapped — the
 *                           store reads `Project[]` directly)
 *   - /api/projects/:id/sessions → []
 *   - /v1/research/tree   → fixture
 *   - /v1/research/file   → fixture
 *   - /v1/research/status → fixture
 */

import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Page } from "@playwright/test";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dir, "../fixtures");

export const PROJECT_FIXTURE = {
  id: "test-project-1",
  name: "test-project",
  path: "/tmp/test-project",
  createdAt: "2026-05-01T00:00:00Z",
};

export const MASKED_CONFIG_RESPONSE = {
  ok: true,
  config: {
    apiKey: "sk-test",
    port: 1337,
    providers: [
      {
        name: "anthropic",
        kind: "anthropic",
        apiKey: "••••••••",
        model: "claude-3-5-sonnet-latest",
      },
    ],
    defaultProvider: "anthropic",
    logLevel: "info",
    projectPath: "/tmp/test-project",
    agents: {},
    mcp: [],
    tokenBudgetPercent: 10,
    hardwareAccelerationDisabled: false,
    research: {
      enabled: true,
      provider: "bundled-cpu",
    },
  },
};

function readFixture(file: string): unknown {
  const raw = fs.readFileSync(path.join(FIXTURES, file), "utf8");
  return JSON.parse(raw);
}

export const TREE_FIXTURE = readFixture("research-tree.json") as {
  sections: Array<{ name: string; label: string; files: Array<unknown> }>;
};
export const FILE_FIXTURE = readFixture("research-file.json") as Record<
  string,
  unknown
>;
export const STATUS_FIXTURE = readFixture("research-status.json") as Record<
  string,
  unknown
>;

/** Install all common mocks. Spec-specific overrides should call this first. */
export async function installCommonMocks(page: Page): Promise<void> {
  // Health: connection store needs a green light to render the main UI.
  await page.route(/\/api\/health(\?|$)/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, status: "connected" }),
    });
  });

  // Config — must include a provider with non-empty apiKey for App.svelte
  // to clear the onboarding view and load projects.
  await page.route(/\/api\/config(\?|$)/, async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MASKED_CONFIG_RESPONSE),
    });
  });

  // Projects list: GET returns Project[] directly (no envelope).
  // POST (open project) echoes the existing fixture so flow continues.
  // Per-project sessions return an empty list.
  await page.route(/\/api\/projects(\/[^/]+\/sessions)?(\?.*)?$/, async (route) => {
    const url = route.request().url();
    if (/\/sessions(\?|$)/.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
      return;
    }
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(PROJECT_FIXTURE),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([PROJECT_FIXTURE]),
    });
  });

  // Research API surface — fixtures cover the happy path the UI exercises.
  // Use a single broad regex; the inner switch picks the right fixture so
  // we don't have multiple overlapping handlers fighting each other.
  //
  // Note: registered on the BrowserContext (not the page) because the
  // research-client's `fetch()` for /v1/research/* is dispatched in a
  // way `page.route` doesn't always intercept (service-worker boundary).
  // `context.route` covers the page plus any worker-initiated requests.
  await page.context().route(/\/v1\/research\//, async (route) => {
    const url = route.request().url();
    if (url.includes("/v1/research/tree")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(TREE_FIXTURE),
      });
      return;
    }
    if (url.includes("/v1/research/file")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FILE_FIXTURE),
      });
      return;
    }
    if (url.includes("/v1/research/status")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(STATUS_FIXTURE),
      });
      return;
    }
    // Catch-all for other research endpoints (search, reindex, etc.)
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });
}

/** Navigate to the app and wait for the shell. */
export async function loadAppShell(page: Page): Promise<void> {
  await page.goto("/", { timeout: 15000, waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Toggle sidebar" })
    .waitFor({ state: "visible", timeout: 15000 });
  // A short settle window to let onMount fetch /api/config + /api/projects.
  await page.waitForTimeout(600);
}

/**
 * Click the first "Open project" card on the project picker. Returns true
 * if the card was found and clicked, false if the picker was missing
 * (e.g. onboarding never cleared because mocks didn't run in time).
 */
export async function openFirstProject(page: Page): Promise<boolean> {
  const card = page.getByRole("button", { name: /^Open project /i }).first();
  const visible = await card.isVisible({ timeout: 5000 }).catch(() => false);
  if (!visible) return false;
  await card.click();
  // Activation triggers chat navigation; wait for the sidebar nav update.
  await page.waitForTimeout(800);
  return true;
}
