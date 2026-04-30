import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const OUTPUT_DIR = resolve(__dirname, '..', '..', 'docs', 'screenshots', 'quire-ui');
mkdirSync(OUTPUT_DIR, { recursive: true });

async function capture() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });

  const themes = ['dark', 'light'];

  async function setTheme(page, theme) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(600);
  }

  async function captureShot(page, name, theme) {
    await page.screenshot({ path: join(OUTPUT_DIR, `${name}-${theme}.png`), fullPage: false });
    console.log(`  ${name}-${theme}.png`);
  }

  async function clickNav(page, text) {
    try {
      const item = page.locator(`text=${text}`).first();
      if (await item.isVisible({ timeout: 3000 })) {
        await item.click();
        await page.waitForTimeout(800);
        return true;
      }
    } catch { return false; }
  }

  for (const theme of themes) {
    const page = await ctx.newPage();
    await page.goto('http://localhost:1420/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    await setTheme(page, theme);
    await captureShot(page, '01-project-picker', theme);
    await page.close();
  }

  for (const theme of themes) {
    const page = await ctx.newPage();
    await page.goto('http://localhost:1420/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await clickNav(page, 'Settings');
    await setTheme(page, theme);
    await captureShot(page, '02-settings', theme);
    await page.close();
  }

  for (const theme of themes) {
    const page = await ctx.newPage();
    await page.goto('http://localhost:1420/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await clickNav(page, 'Models');
    await setTheme(page, theme);
    await captureShot(page, '03-models', theme);
    await page.close();
  }

  for (const theme of themes) {
    const page = await ctx.newPage();
    await page.goto('http://localhost:1420/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await clickNav(page, 'Agent Config');
    await setTheme(page, theme);
    await captureShot(page, '04-agent-config', theme);
    await page.close();
  }

  for (const theme of themes) {
    const page = await ctx.newPage();
    await page.goto('http://localhost:1420/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await clickNav(page, 'Runs');
    await setTheme(page, theme);
    await captureShot(page, '05-runs', theme);
    await page.close();
  }

  for (const theme of themes) {
    const page = await ctx.newPage();
    await page.goto('http://localhost:1420/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await clickNav(page, 'Spec');
    await setTheme(page, theme);
    await captureShot(page, '06-spec', theme);
    await page.close();
  }

  for (const theme of themes) {
    const page = await ctx.newPage();
    await page.goto('http://localhost:1420/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await clickNav(page, 'Worktrees');
    await setTheme(page, theme);
    await captureShot(page, '07-worktrees', theme);
    await page.close();
  }

  for (const theme of themes) {
    const page = await ctx.newPage();
    await page.goto('http://localhost:1420/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await clickNav(page, 'About');
    await setTheme(page, theme);
    await captureShot(page, '08-about', theme);
    await page.close();
  }

  for (const theme of themes) {
    const page = await ctx.newPage();
    await page.goto('http://localhost:1420/#design-system', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await setTheme(page, theme);
    await captureShot(page, '09-design-system', theme);
    await page.close();
  }

  await browser.close();
  console.log(`\nAll screenshots saved to ${OUTPUT_DIR}`);
}

capture().catch((err) => { console.error('capture failed', err); process.exit(1); });
