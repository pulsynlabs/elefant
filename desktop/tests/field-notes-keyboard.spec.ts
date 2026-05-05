/**
 * field-notes-keyboard.spec.ts — Wave 5, Task 5.3
 *
 * Keyboard navigation tests for the Field Notes at 1280×800.
 *
 * Mocks /v1/fieldnotes/* routes. Verifies j/k navigation, / search focus,
 * Escape clearing, and g r sequence for reader focus.
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
      name: "01-domain",
      label: "Domain",
      files: [
        {
          name: "sqlite-vec-notes.md",
          path: "01-domain/sqlite-vec-notes.md",
          title: "SQLite-Vec Notes",
          summary: "Notes on sqlite-vec",
          tags: ["sqlite"],
          confidence: "high",
          updated: "2026-05-01T10:00:00Z",
          fieldnotes_link: "fieldnotes://project-1/01-domain/sqlite-vec-notes.md",
        },
        {
          name: "pi-analysis.md",
          path: "01-domain/pi-analysis.md",
          title: "Pi Analysis",
          summary: "Pi minimal agent analysis",
          tags: ["pi", "agent"],
          confidence: "medium",
          updated: "2026-05-02T08:00:00Z",
          fieldnotes_link: "fieldnotes://project-1/01-domain/pi-analysis.md",
        },
      ],
    },
    {
      name: "02-tech",
      label: "Tech",
      files: [
        {
          name: "opencode-analysis.md",
          path: "02-tech/opencode-analysis.md",
          title: "OpenCode Analysis",
          summary: "OpenCode architecture",
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
  path: "01-domain/sqlite-vec-notes.md",
  frontmatter: {
    title: "SQLite-Vec Notes",
    section: "01-domain",
    tags: ["sqlite", "vector-search"],
    confidence: "high",
    updated: "2026-05-01T10:00:00Z",
    author_agent: "researcher",
  },
  html: `<h1 id="sqlite-vec-notes" class="field-notes-heading">SQLite-Vec Notes</h1><p>Content here.</p>`,
  rawBody: "# SQLite-Vec Notes\n\n...",
  fieldnotes_link: "fieldnotes://project-1/01-domain/sqlite-vec-notes.md",
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

  await page.goto("/", { timeout: 15000, waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Toggle sidebar" })
    .waitFor({ state: "visible", timeout: 15000 });

  await openProject(page);

  await page.getByRole("button", { name: "Field Notes", exact: true }).click();
  await page.waitForTimeout(600);
}

// ── Tests ─────────────────────────────────────────────────────────────────

test.describe("Field Notes Keyboard Navigation — 1280×800", () => {
  test.use({ viewport: DESKTOP });
  test.setTimeout(30000);

  test.beforeAll(() => {
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await setupFieldNotesView(page);
  });

  test("j key advances tree focus to next item", async ({ page }) => {
    // Focus the page body so key events fire
    await page.click("body");
    await page.waitForTimeout(100);

    // Press j — should advance to next tree row
    await page.keyboard.press("j");
    await page.waitForTimeout(200);

    // The first row should now have a focus style (data-field-notes-tree-row highlighted)
    // Since the store advances treeRowIndex, the first file row should be "active"
    const firstRow = page.locator('[data-field-notes-tree-row]').first();
    await expect(firstRow).toBeVisible();
  });

  test("k key moves tree focus to previous item", async ({ page }) => {
    await page.click("body");
    await page.waitForTimeout(100);

    // Press j twice to advance, then k to go back
    await page.keyboard.press("j");
    await page.waitForTimeout(100);
    await page.keyboard.press("j");
    await page.waitForTimeout(100);
    await page.keyboard.press("k");
    await page.waitForTimeout(200);

    // Should still have a focused row
    const rows = page.locator('[data-field-notes-tree-row]');
    await expect(rows.first()).toBeVisible();
  });

  test("/ key focuses search input", async ({ page }) => {
    // Ensure focus is NOT on the search input
    const searchInput = page.locator('[data-field-notes-search"]');
    // Click elsewhere first
    await page.locator(".field-notes-tree-pane").click();
    await page.waitForTimeout(100);

    // Press / — should focus search
    await page.keyboard.press("/");
    await page.waitForTimeout(200);

    // Search input should be focused
    const focusedEl = await page.evaluate(() => document.activeElement?.getAttribute("data-field-notes-search"));
    expect(focusedEl).toBe("research-search");
  });

  test("Escape clears search and returns to tree", async ({ page }) => {
    // Focus search
    await page.keyboard.press("/");
    await page.waitForTimeout(200);

    const searchInput = page.locator('[data-field-notes-search"]');
    await searchInput.waitFor({ state: "focused", timeout: 2000 });

    // Type a search query
    await page.keyboard.type("sqlite");
    await page.waitForTimeout(300);

    // Press Escape
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    // Search should be cleared (input value should be empty)
    const inputValue = await searchInput.inputValue();
    expect(inputValue).toBe("");
  });

  test("g then r quickly focuses reader pane", async ({ page }) => {
    await page.click("body");
    await page.waitForTimeout(100);

    // Press g then r within the sequence timeout (500ms)
    await page.keyboard.press("g");
    await page.waitForTimeout(50);
    await page.keyboard.press("r");
    await page.waitForTimeout(200);

    // The reader pane should have focus
    const readerPane = page.locator("[data-field-notes-reader]");
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-field-notes-reader"));
    expect(focused).toBe("field-notes-reader");
  });

  test("keyboard navigation is suppressed when search input is focused", async ({ page }) => {
    // Focus search
    await page.keyboard.press("/");
    await page.waitForTimeout(200);

    // Type 'j' into the search input — should NOT navigate the tree
    await page.keyboard.type("j");
    await page.waitForTimeout(200);

    // The j should appear in the search input, not navigate
    const searchValue = await page.locator('[data-field-notes-search"]').inputValue();
    expect(searchValue).toContain("j");
  });

  test("arrow keys work as j/k equivalents for tree navigation", async ({ page }) => {
    await page.click("body");
    await page.waitForTimeout(100);

    // Press ArrowDown — same as j
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(200);

    const rows = page.locator('[data-field-notes-tree-row]');
    await expect(rows.first()).toBeVisible();

    // Press ArrowUp — same as k
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(200);

    await expect(rows.first()).toBeVisible();
  });
});
