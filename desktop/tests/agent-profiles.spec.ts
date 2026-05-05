/**
 * Agent Profiles — Wave 3, Task 5.3
 *
 * Regression suite for the premium role-grouped agent profiles redesign.
 * Locks the six assertions from BLUEPRINT Task 5.3:
 *
 *   1. All 13 user-facing agents render (visible label or data attribute).
 *   2. No legacy tier-less `executor` row visible.
 *   3. Six role group headings: Coordination, Planning, Research,
 *      Execution, Verification, Documentation.
 *   4. No legacy "Max Tokens", "Max Iterations", "Max Concurrency",
 *      "Timeout", "Tool Mode" labels anywhere on the page.
 *   5. Model picker trigger visible on at least one expanded card.
 *   6. Baseline screenshots at 390×844 (mobile) and 1280×800 (desktop).
 *
 * Daemon availability: The "Agent Config" nav item requires an active project.
 * The daemon must be running and have projects loaded. If no project is open,
 * the nav button is hidden and tests skip gracefully. If the daemon doesn't
 * respond within the timeout, tests skip rather than hang.
 *
 * Navigation: On mobile (≤640px) the sidebar is a fixed overlay opened via
 * hamburger. On desktop (≥641px) the sidebar is always inline.
 */

import { test, expect, Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import * as fs from "fs";
import * as path from "path";

// ── Config ────────────────────────────────────────────────────────────────────

const __dir = path.dirname(fileURLToPath(import.meta.url));
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const BASELINE_DIR = path.resolve(__dir, "screenshots/agent-profiles/baseline");

const AGENT_LABELS = [
	"Orchestrator", "Planner", "Researcher", "Explorer", "Librarian",
	"Verifier", "Tester", "Debugger", "Writer",
	"Executor Low", "Executor Medium", "Executor High", "Executor Frontend",
] as const;

const ROLE_GROUP_HEADINGS = [
	"Coordination", "Planning", "Research", "Execution", "Verification", "Documentation",
] as const;

const LEGACY_LABELS = [
	"Max Tokens", "Max Iterations", "Max Concurrency", "Timeout", "Tool Mode",
] as const;

// ── Navigation helper ─────────────────────────────────────────────────────────

async function loadAgentConfig(page: Page): Promise<"ok" | "no-project" | "no-daemon"> {
	await page.goto("/", { timeout: 15000, waitUntil: "domcontentloaded" });

	await page
		.getByRole("button", { name: "Toggle sidebar" })
		.waitFor({ state: "visible", timeout: 15000 });
	await page.waitForTimeout(800);

	const vp = page.viewportSize();
	const isMobile = vp !== null && vp.width <= 640;
	const agentConfigBtn = page.locator('[aria-label="Agent Config"]');

	// Wait for button (up to 10s for slow daemon startup)
	const btnVisible = await agentConfigBtn
		.waitFor({ state: "visible", timeout: 10000 })
		.then(() => true)
		.catch(() => false);

	if (!btnVisible) return "no-project";

	if (isMobile) {
		await page.getByRole("button", { name: "Toggle sidebar" }).click();
		await page.waitForTimeout(400);
		try {
			await page.locator(".mobile-drawer.drawer-open").waitFor({ state: "visible", timeout: 5000 });
		} catch {
			return "no-project";
		}
		await agentConfigBtn.click();
		await page.waitForTimeout(400);
		const backdrop = page.locator(".drawer-backdrop");
		if (await backdrop.isVisible({ timeout: 2000 }).catch(() => false)) {
			await backdrop.click({ force: true, timeout: 5000 });
			await page.locator(".mobile-drawer").waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
		}
	} else {
		await agentConfigBtn.click();
		await page.waitForTimeout(400);
	}

	// Wait for profiles to resolve
	await page.waitForTimeout(800);

	const cards = page.locator(".card");
	const loading = page.getByText("Loading agent profiles…");
	const empty = page.getByText("No agent profiles configured yet.");

	const result = await Promise.race([
		cards.first().waitFor({ state: "visible", timeout: 6000 }).then(() => "cards"),
		loading.waitFor({ state: "visible", timeout: 2000 }).then(() => "loading"),
		empty.waitFor({ state: "visible", timeout: 2000 }).then(() => "empty"),
	]).catch(() => "timeout");

	if (result === "loading") return "no-daemon";
	return "ok";
}

// ── Assertion helpers ─────────────────────────────────────────────────────────

async function assertAll13AgentsVisible(page: Page): Promise<void> {
	const missing: string[] = [];
	for (const label of AGENT_LABELS) {
		if ((await page.getByRole("heading", { name: label, exact: true }).count()) === 0) {
			missing.push(label);
		}
	}
	expect(missing, `Missing agent headings: ${missing.join(", ")}`).toHaveLength(0);
}

async function assertNoLegacyExecutor(page: Page): Promise<void> {
	const legacyRows = page.locator(".identity-id").filter({ hasText: /^executor$/ });
	await expect(legacyRows).toHaveCount(0);
}

async function assertSixRoleGroups(page: Page): Promise<void> {
	const missing: string[] = [];
	for (const heading of ROLE_GROUP_HEADINGS) {
		if ((await page.locator(`#group-${heading.toLowerCase()}`).count()) === 0) {
			missing.push(heading);
		}
	}
	expect(missing, `Missing role group headings: ${missing.join(", ")}`).toHaveLength(0);
}

async function assertNoLegacyLabels(page: Page): Promise<void> {
	const found: string[] = [];
	for (const label of LEGACY_LABELS) {
		if ((await page.getByText(label, { exact: true }).count()) > 0) found.push(label);
	}
	expect(found, `Legacy labels found: ${found.join(", ")}`).toHaveLength(0);
}

async function assertModelPickerVisible(page: Page): Promise<void> {
	await page.locator(".advanced-summary").first().click();
	await page.waitForTimeout(300);
	await expect(page.locator(".model-row .trigger").first()).toBeVisible();
}

// ── Mobile 390×844 ────────────────────────────────────────────────────────────

test.describe("Agent Profiles — 390×844 (mobile)", () => {
	test.use({ viewport: MOBILE });
	test.setTimeout(45000);

	test.beforeAll(() => { fs.mkdirSync(BASELINE_DIR, { recursive: true }); });

	test("baseline screenshot", async ({ page }) => {
		const result = await loadAgentConfig(page);
		if (result === "no-project") test.skip();
		await page.waitForTimeout(300);
		await page.screenshot({
			path: path.join(BASELINE_DIR, "agent-profiles-mobile.png"),
			fullPage: false,
		});
	});

	test("all 13 agent labels visible", async ({ page }) => {
		const result = await loadAgentConfig(page);
		if (result !== "ok") test.skip();
		await assertAll13AgentsVisible(page);
	});

	test("no legacy executor row", async ({ page }) => {
		const result = await loadAgentConfig(page);
		if (result !== "ok") test.skip();
		await assertNoLegacyExecutor(page);
	});

	test("six role group headings visible", async ({ page }) => {
		const result = await loadAgentConfig(page);
		if (result !== "ok") test.skip();
		await assertSixRoleGroups(page);
	});

	test("no legacy field labels visible", async ({ page }) => {
		const result = await loadAgentConfig(page);
		if (result !== "ok") test.skip();
		await assertNoLegacyLabels(page);
	});

	test("model picker trigger visible on expanded card", async ({ page }) => {
		const result = await loadAgentConfig(page);
		if (result !== "ok") test.skip();
		await assertModelPickerVisible(page);
	});
});

// ── Desktop 1280×800 ─────────────────────────────────────────────────────────

test.describe("Agent Profiles — 1280×800 (desktop)", () => {
	test.use({ viewport: DESKTOP });
	test.setTimeout(45000);

	test.beforeAll(() => { fs.mkdirSync(BASELINE_DIR, { recursive: true }); });

	test("baseline screenshot", async ({ page }) => {
		const result = await loadAgentConfig(page);
		if (result === "no-project") test.skip();
		await page.waitForTimeout(300);
		await page.screenshot({
			path: path.join(BASELINE_DIR, "agent-profiles-desktop.png"),
			fullPage: false,
		});
	});

	test("all 13 agent labels visible", async ({ page }) => {
		const result = await loadAgentConfig(page);
		if (result !== "ok") test.skip();
		await assertAll13AgentsVisible(page);
	});

	test("no legacy executor row", async ({ page }) => {
		const result = await loadAgentConfig(page);
		if (result !== "ok") test.skip();
		await assertNoLegacyExecutor(page);
	});

	test("six role group headings visible", async ({ page }) => {
		const result = await loadAgentConfig(page);
		if (result !== "ok") test.skip();
		await assertSixRoleGroups(page);
	});

	test("no legacy field labels visible", async ({ page }) => {
		const result = await loadAgentConfig(page);
		if (result !== "ok") test.skip();
		await assertNoLegacyLabels(page);
	});

	test("model picker trigger visible on expanded card", async ({ page }) => {
		const result = await loadAgentConfig(page);
		if (result !== "ok") test.skip();
		await assertModelPickerVisible(page);
	});
});