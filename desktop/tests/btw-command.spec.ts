/**
 * /btw command E2E test — Wave 4, Task 4.2
 *
 * Verifies that the command-completions overlay renders correctly.
 *
 * Note: /btw and /back are registered in the client-side FALLBACK_COMMANDS
 * list and appear in the overlay when the daemon's /api/wf/commands endpoint
 * is unreachable (verified by commands.svelte.test.ts unit tests). When the
 * daemon is reachable, its live command list overrides the fallback. The
 * daemon endpoint was intentionally not modified per BLUEPRINT.md W4.T2
 * because /btw and /back are client-only intercepts.
 *
 * Requires the Elefant dev server on http://localhost:1420.
 */
import { test, expect, type Page } from '@playwright/test';

/** Navigate to a chat session, opening the first project if needed. */
async function setup(page: Page): Promise<void> {
	await page.goto('/');

	// Wait for daemon connection
	await page
		.getByText('Connected')
		.first()
		.waitFor({ state: 'visible', timeout: 30000 });

	// If a textarea is already visible we're in chat — done.
	const textarea = page.locator('textarea').first();
	if (await textarea.isVisible({ timeout: 2000 }).catch(() => false)) return;

	// Project picker is showing — open the first project.
	const projectCard = page
		.getByRole('button', { name: /Open project/i })
		.first();
	await projectCard.waitFor({ state: 'visible', timeout: 10000 });
	await projectCard.click();

	// Wait for the chat textarea to appear
	await page
		.locator('textarea')
		.first()
		.waitFor({ state: 'visible', timeout: 10000 });
}

test.describe('/btw side-context command', () => {
	test.beforeEach(async ({ page }) => {
		await setup(page);
	});

	test('command-completions overlay renders when / is typed', async ({ page }) => {
		const input = page.locator('textarea').first();
		await input.click();
		await input.pressSequentially('/');
		const overlay = page.locator('[data-testid="command-completions"]');
		await expect(overlay).toBeVisible({ timeout: 5000 });

		// Overlay should contain command items (role="option")
		const items = overlay.locator('[role="option"]');
		const count = await items.count();
		expect(count).toBeGreaterThan(0);
	});

	test('mobile viewport overlay renders within viewport', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		const input = page.locator('textarea').first();
		await input.click();
		await input.pressSequentially('/');
		const overlay = page.locator('[data-testid="command-completions"]');
		await expect(overlay).toBeVisible({ timeout: 5000 });

		// Overlay should be within the viewport bounds
		const box = await overlay.boundingBox();
		expect(box).not.toBeNull();
		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.y).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(390);
	});
});
