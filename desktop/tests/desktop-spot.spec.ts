/**
 * Desktop Layout Spot-Check — Wave 3, Task 3.2
 *
 * Confirms zero desktop regression after the mobile-responsive fixes.
 * All mobile changes are scoped to @media (max-width: 640px) and JS
 * layout-mode guards, so desktop behavior at and above 900px must be
 * identical to pre-change.
 *
 *   Test Group 1: Sidebar inline at 1280×800
 *     - .app-shell does NOT have mode-mobile class
 *     - .mobile-drawer is NOT in the DOM
 *     - .drawer-backdrop is NOT in the DOM
 *     - .sidebar is visible with width > 100px
 *     - Baseline screenshot committed
 *
 *   Test Group 2: Sidebar collapse at 900px
 *     - Resize 1280 → 900: .app-shell gets mode-collapsed (NOT mode-mobile)
 *     - Resize 900 → 1280: mode-collapsed removed
 *     - Drawer still absent at 900px
 *
 *   Test Group 3: Manual hamburger toggle
 *     - Click hamburger: toggles inline collapsed/expanded
 *     - Drawer never appears
 *
 * Navigation: At desktop the sidebar is always inline (never an overlay).
 */

import { test, expect, Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import * as fs from "fs";
import * as path from "path";

// ── Config ────────────────────────────────────────────────────────────────────

const __dir = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = { width: 1280, height: 800 };
const COLLAPSED = { width: 900, height: 800 };
const BASELINE_DIR = path.resolve(__dir, "screenshots/desktop/baseline");

async function loadApp(page: Page): Promise<void> {
	await page.goto("/", { timeout: 15000, waitUntil: "domcontentloaded" });
	await page
		.getByRole("button", { name: "Toggle sidebar" })
		.waitFor({ state: "visible", timeout: 15000 });
	await page.waitForTimeout(500);
}

// ── Test Group 1: Sidebar inline at 1280×800 ──────────────────────────────────

test.describe("Desktop Layout Spot-Check — 1280×800", () => {
	test.use({ viewport: DESKTOP });

	test.beforeAll(() => {
		fs.mkdirSync(BASELINE_DIR, { recursive: true });
	});

	test("sidebar is inline grid column (not overlay) at 1280×800", async ({
		page,
	}) => {
		await loadApp(page);

		// The AppShell should NOT have the mode-mobile class at desktop width
		const appShell = page.locator(".app-shell");
		await expect(appShell).not.toHaveClass(/mode-mobile/);

		// The mobile drawer should NOT be in the DOM at desktop width
		// (guarded by {#if layoutMode === 'mobileOverlay'} in App.svelte)
		const drawer = page.locator(".mobile-drawer");
		await expect(drawer).toHaveCount(0);

		// Backdrop should NOT be in the DOM at desktop width
		// (guarded by {#if layoutMode === 'mobileOverlay' && drawerOpen})
		const backdrop = page.locator(".drawer-backdrop");
		await expect(backdrop).toHaveCount(0);

		// Sidebar grid column should be visible and have positive width.
		// At desktop the sidebar is an inline grid column (not a fixed overlay).
		const sidebar = page.locator(".sidebar");
		await expect(sidebar).toBeVisible();

		const sidebarBox = await sidebar.boundingBox();
		expect(
			sidebarBox?.width,
			`Sidebar width ${sidebarBox?.width}px should be > 100px at desktop`
		).toBeGreaterThan(100);

		// Take baseline screenshot for visual regression
		await page.screenshot({
			path: path.join(BASELINE_DIR, "chat.png"),
			fullPage: false,
		});
	});

	// ── Test Group 2: Sidebar collapse at 900px ───────────────────────────────

	test("sidebar collapse works at 900px (existing behavior preserved)", async ({
		page,
	}) => {
		// Start at full desktop
		await page.setViewportSize(DESKTOP);
		await loadApp(page);

		const appShell = page.locator(".app-shell");

		// At 1280px: expanded — no mode class
		await expect(appShell).not.toHaveClass(/mode-mobile/);
		await expect(appShell).not.toHaveClass(/mode-collapsed/);

		// Resize to 900px: app should enter collapsed mode
		await page.setViewportSize(COLLAPSED);
		await page.waitForTimeout(400); // wait for resize handler + debounce

		// At 900px: mode-collapsed (NOT mode-mobile — mobile is ≤640px)
		await expect(appShell).toHaveClass(/mode-collapsed/);
		await expect(appShell).not.toHaveClass(/mode-mobile/);

		// Sidebar still inline (not overlay drawer)
		const drawer = page.locator(".mobile-drawer");
		await expect(drawer).toHaveCount(0);

		// Resize back to full desktop
		await page.setViewportSize(DESKTOP);
		await page.waitForTimeout(400);
		await expect(appShell).not.toHaveClass(/mode-collapsed/);
	});

	// ── Test Group 3: Manual hamburger toggle ─────────────────────────────────

	test("manual hamburger toggle works at desktop (expanded ↔ collapsed)", async ({
		page,
	}) => {
		await page.setViewportSize(DESKTOP);
		await loadApp(page);

		const appShell = page.locator(".app-shell");

		// Initially expanded at 1280px
		await expect(appShell).not.toHaveClass(/mode-collapsed/);

		// Click hamburger → collapses sidebar inline
		await page.getByRole("button", { name: "Toggle sidebar" }).click();
		await page.waitForTimeout(300);
		await expect(appShell).toHaveClass(/mode-collapsed/);

		// Click again → expands sidebar inline
		await page.getByRole("button", { name: "Toggle sidebar" }).click();
		await page.waitForTimeout(300);
		await expect(appShell).not.toHaveClass(/mode-collapsed/);

		// The mobile drawer should never have appeared during this test —
		// the hamburger in desktop mode toggles inline collapse, not the drawer.
		const drawer = page.locator(".mobile-drawer");
		await expect(drawer).toHaveCount(0);
	});
});
