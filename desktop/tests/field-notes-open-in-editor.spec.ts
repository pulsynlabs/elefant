/**
 * field-notes-open-in-editor.spec.ts — Wave 5, Task 5.3
 *
 * Tests the "Open in editor" button in the Research reader pane.
 *
 * Mocks POST /v1/fieldnotes/open-in-editor and verifies:
 * - The correct path is sent in the request body
 * - The success flash appears briefly
 */

import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as path from "path";

const DESKTOP = { width: 1280, height: 800 };
const __dir = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = path.resolve(__dir, "screenshots/research/baseline");

// ── Fixtures ────────────────────────────────────────────────────────────────

const TREE_RESPONSE = {
  sections: [
    {
      name: "02-tech",
      label: "Tech",
      files: [
        {
          name: "opencode-analysis.md",
          path: "02-tech/opencode-analysis.md",
          title: "OpenCode Analysis",
          summary: "Deep dive into OpenCode",
          tags: ["opencode"],
          confidence: "high",
          updated: "2026-05-02T14:30:00Z",
          fieldnotes_link: "fieldnotes://project-1/02-tech/opencode-analysis.md",
        },
      ],
    },
  ],
  lastRefreshed: "2026-05-03T12:00:00Z",
};

const FILE_RESPONSE = {
  path: "02-tech/opencode-analysis.md",
  frontmatter: {
    title: "OpenCode Analysis",
    section: "02-tech",
    tags: ["opencode", "architecture"],
    confidence: "high",
    updated: "2026-05-02T14:30:00Z",
    author_agent: "researcher",
  },
  html: `<h1 id="opencode-analysis" class="field-notes-heading">OpenCode Analysis</h1><p>Content here.</p>`,
  rawBody: "# OpenCode Analysis\n\n...",
  fieldnotes_link: "fieldnotes://project-1/02-tech/opencode-analysis.md",
};

// ── Helpers ───────────────────────────────────────────────────────────────

async function openProject(page: Page): Promise<void> {
  const openBtn = page.getByRole("button", { name: /Open project/i }).first();
  if (await openBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await openBtn.click();
    await page.waitForTimeout(1000);
  }
}

async function setupFieldNotesView(page: Page): Promise<void> {
  await page.route(/v1\/research\/tree/, async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(TREE_RESPONSE) });
  });
  await page.route(/v1\/research\/file/, async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(FILE_RESPONSE) });
  });
  // Default: editor launch fails (so tests that DON'T mock this fail by default)
  await page.route(/v1\/research\/open-in-editor/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ launched: false, error: "Not mocked" }),
    });
  });

  await page.goto("/", { timeout: 15000, waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Toggle sidebar" })
    .waitFor({ state: "visible", timeout: 15000 });

  await openProject(page);

  await page.getByRole("button", { name: "Field Notes", exact: true }).click();
  await page.waitForTimeout(600);

  // Select the file
  await page.getByText("OpenCode Analysis").click();
  await page.waitForTimeout(800);
}

// ── Tests ─────────────────────────────────────────────────────────────────

test.describe("Open In Editor Button — 1280×800", () => {
  test.use({ viewport: DESKTOP });
  test.setTimeout(30000);

  test.beforeAll(() => {
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await setupFieldNotesView(page);
  });

  test("button is visible and clickable when file is loaded", async ({ page }) => {
    const openBtn = page.locator(".open-in-editor-btn");
    await expect(openBtn).toBeVisible();
    await expect(openBtn).toBeEnabled();
  });

  test("clicking button calls POST /v1/fieldnotes/open-in-editor with correct path", async ({ page }) => {
    let requestBody: Record<string, unknown> | null = null;

    // Override the route with a tracking one
    await page.route(/v1\/research\/open-in-editor/, async (route) => {
      const body = route.request().postData();
      if (body) requestBody = JSON.parse(body);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ launched: true, command: "code" }),
      });
    });

    const openBtn = page.locator(".open-in-editor-btn");
    await openBtn.click();
    await page.waitForTimeout(500);

    // Verify the request body
    expect(requestBody).not.toBeNull();
    expect(requestBody!.projectId).toBe("project-1");
    expect(requestBody!.path).toBe("02-tech/opencode-analysis.md");
  });

  test("successful launch shows success flash", async ({ page }) => {
    await page.route(/v1\/research\/open-in-editor/, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ launched: true, command: "code" }),
      });
    });

    const openBtn = page.locator(".open-in-editor-btn");
    await openBtn.click();
    await page.waitForTimeout(300);

    // Button should transition to success state
    await expect(openBtn).toHaveClass(/is-success/);

    // Should show "Opened" label
    await expect(page.locator(".btn-label")).toContainText("Opened");
  });

  test("failed launch shows error state", async ({ page }) => {
    await page.route(/v1\/research\/open-in-editor/, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ launched: false, error: "Editor not found" }),
      });
    });

    const openBtn = page.locator(".open-in-editor-btn");
    await openBtn.click();
    await page.waitForTimeout(300);

    // Button should transition to error state
    await expect(openBtn).toHaveClass(/is-error/);

    // Should show "Failed" label
    await expect(page.locator(".btn-label")).toContainText("Failed");
  });

  test("button shows launching state while request is in-flight", async ({ page }) => {
    // Slow response to catch the launching state
    await page.route(/v1\/research\/open-in-editor/, async (route) => {
      // Delay the response by 500ms
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ launched: true }),
      });
    });

    const openBtn = page.locator(".open-in-editor-btn");
    await openBtn.click();

    // Immediately after click — button should be disabled during launch
    // (give a tiny tick for the state to update)
    await page.waitForTimeout(50);
    await expect(openBtn).toBeDisabled();
  });
});
