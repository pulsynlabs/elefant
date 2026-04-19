/**
 * Premium UI Genesis — Playwright visual + functional audit
 * Branch: feat/premium-ui-genesis
 *
 * Tests verify:
 *   1. Design tokens (primary color, fonts, glows)
 *   2. Dark mode rendering — all views
 *   3. Light mode rendering — all views
 *   4. Theme toggle works
 *   5. Sidebar interactions (active state, translateX, collapse)
 *   6. No amber/gold color references leaking through
 *   7. Typography — Instrument Serif on headings, DM Sans on body
 *   8. Glass system rendering
 */

import { test, expect, Page } from "@playwright/test";

const BASE = "http://localhost:1420";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getToken(page: Page, token: string): Promise<string> {
  return page.evaluate(
    (t) =>
      getComputedStyle(document.documentElement)
        .getPropertyValue(t)
        .trim(),
    token
  );
}

async function getComputedProp(
  page: Page,
  selector: string,
  prop: string
): Promise<string> {
  return page.evaluate(
    ([sel, p]) => {
      const el = document.querySelector(sel as string);
      return el ? getComputedStyle(el).getPropertyValue(p as string).trim() : "NOT_FOUND";
    },
    [selector, prop]
  );
}

async function setTheme(page: Page, theme: "dark" | "light"): Promise<void> {
  await page.evaluate(
    (t) => document.documentElement.setAttribute("data-theme", t),
    theme
  );
  await page.waitForTimeout(100);
}

async function openProject(page: Page): Promise<void> {
  // If project picker is showing, open the existing project
  const projectBtn = page.getByRole("button", { name: /Open project/ });
  if (await projectBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await projectBtn.click();
    await page.waitForTimeout(300);
  }
}

async function navigateTo(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: label }).click();
  await page.waitForTimeout(200);
}

// ─── Suite 1: Token Verification ────────────────────────────────────────────

test.describe("Design Tokens", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    await setTheme(page, "dark");
  });

  test("primary color is #4049e1", async ({ page }) => {
    const primary = await getToken(page, "--color-primary");
    expect(primary).toBe("#4049e1");
  });

  test("dark background is #09090e (OLED indigo tint)", async ({ page }) => {
    const bg = await getToken(page, "--color-bg");
    expect(bg).toBe("#09090e");
  });

  test("font-serif is Instrument Serif", async ({ page }) => {
    const serif = await getToken(page, "--font-serif");
    expect(serif).toContain("Instrument Serif");
  });

  test("font-sans is DM Sans (not Geist Sans)", async ({ page }) => {
    const sans = await getToken(page, "--font-sans");
    expect(sans).toContain("DM Sans");
    expect(sans).not.toContain("Geist Sans");
  });

  test("font-mono is Geist Mono (unchanged)", async ({ page }) => {
    const mono = await getToken(page, "--font-mono");
    expect(mono).toContain("Geist Mono");
  });

  test("glow-primary uses indigo rgba", async ({ page }) => {
    const glow = await getToken(page, "--glow-primary");
    expect(glow).toContain("64, 73, 225");
  });

  test("ease-spring is upgraded cubic-bezier", async ({ page }) => {
    const easing = await getToken(page, "--ease-spring");
    expect(easing).toBe("cubic-bezier(0.32, 0.72, 0, 1)");
  });

  test("ease-out-expo exists (new token)", async ({ page }) => {
    const easing = await getToken(page, "--ease-out-expo");
    expect(easing).toBe("cubic-bezier(0.19, 1, 0.22, 1)");
  });

  test("duration-micro exists (new token)", async ({ page }) => {
    const dur = await getToken(page, "--duration-micro");
    expect(dur).toBe("80ms");
  });

  test("light theme primary is still #4049e1", async ({ page }) => {
    await setTheme(page, "light");
    const primary = await getToken(page, "--color-primary");
    expect(primary).toBe("#4049e1");
  });

  test("light theme background is #ffffff", async ({ page }) => {
    await setTheme(page, "light");
    const bg = await getToken(page, "--color-bg");
    expect(bg).toBe("#ffffff");
  });

  test("light theme border is indigo-tinted", async ({ page }) => {
    await setTheme(page, "light");
    const border = await getToken(page, "--color-border");
    expect(border).toBe("#e8eaf8");
  });

  test("no amber colors in dark theme tokens", async ({ page }) => {
    // Read all CSS variables and check none contain amber hex codes
    const hasAmber = await page.evaluate(() => {
      const styles = document.styleSheets;
      for (let i = 0; i < styles.length; i++) {
        try {
          const rules = styles[i].cssRules;
          for (let j = 0; j < rules.length; j++) {
            const text = rules[j].cssText || "";
            if (/F5A623|E09415|C47F0E|f5a623|e09415|c47f0e/i.test(text)) {
              return text.slice(0, 100);
            }
          }
        } catch {
          // cross-origin stylesheet, skip
        }
      }
      return null;
    });
    expect(hasAmber).toBeNull();
  });
});

// ─── Suite 2: Typography ─────────────────────────────────────────────────────

test.describe("Typography", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    await setTheme(page, "dark");
    await openProject(page);
  });

  test("body uses DM Sans", async ({ page }) => {
    const font = await getComputedProp(page, "body", "font-family");
    expect(font).toContain("DM Sans");
  });

  test("h1 elements use Instrument Serif", async ({ page }) => {
    await navigateTo(page, "About");
    const font = await getComputedProp(page, "h1", "font-family");
    expect(font).toContain("Instrument Serif");
  });

  test("h2 elements use Instrument Serif", async ({ page }) => {
    await navigateTo(page, "Agent Config");
    const font = await getComputedProp(page, "h2", "font-family");
    // h2 may or may not exist; if found, it should be serif
    if (font !== "NOT_FOUND") {
      expect(font).toContain("Instrument Serif");
    }
  });

  test("brand wordmark in sidebar uses Instrument Serif italic", async ({
    page,
  }) => {
    const font = await getComputedProp(page, ".brand-name", "font-family");
    const style = await getComputedProp(page, ".brand-name", "font-style");
    expect(font).toContain("Instrument Serif");
    expect(style).toBe("italic");
  });

  test("code/pre elements use Geist Mono", async ({ page }) => {
    const font = await getComputedProp(page, "code", "font-family");
    // code may not exist on landing page; check computed if found
    if (font !== "NOT_FOUND") {
      expect(font).toContain("Geist Mono");
    }
  });
});

// ─── Suite 3: Sidebar Interactions ───────────────────────────────────────────

test.describe("Sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    await setTheme(page, "dark");
    await openProject(page);
  });

  test("active nav item has indigo left accent bar", async ({ page }) => {
    await navigateTo(page, "Settings");
    const shadow = await getComputedProp(page, ".nav-item.active", "box-shadow");
    expect(shadow).toContain("64, 73, 225");
  });

  test("active nav item has translateX(2px) applied", async ({ page }) => {
    await navigateTo(page, "Models");
    const transform = await getComputedProp(page, ".nav-item.active", "transform");
    // matrix(1,0,0,1,2,0) = translateX(2px)
    expect(transform).toMatch(/matrix\(1, 0, 0, 1, 2, 0\)/);
  });

  test("active nav item has pressed-glass gradient background", async ({
    page,
  }) => {
    await navigateTo(page, "About");
    const bg = await getComputedProp(page, ".nav-item.active", "background");
    // New pressed-glass: indigo gradient (not flat primary-subtle)
    expect(bg).toMatch(/linear-gradient|rgba\(64, 73, 225/);
  });

  test("sidebar has glass-md class and SVG filter in DOM", async ({ page }) => {
    // The new glass architecture puts backdrop-filter on ::before pseudo-element,
    // not the element itself — so we verify the class + filter presence instead
    const hasGlassMd = await page.evaluate(() => {
      return document.querySelector(".sidebar.glass-md") !== null;
    });
    const filterInDOM = await page.evaluate(() => {
      return document.getElementById("lg-refraction") !== null;
    });
    expect(hasGlassMd).toBe(true);
    expect(filterInDOM).toBe(true);
  });

  test("sidebar has right border separator", async ({ page }) => {
    const border = await getComputedProp(page, ".sidebar", "border-right");
    expect(border).toContain("1px solid");
  });

  test("brand mark has indigo background", async ({ page }) => {
    const bg = await getComputedProp(page, ".brand-mark", "background-color");
    // #4049e1 = rgb(64, 73, 225)
    expect(bg).toBe("rgb(64, 73, 225)");
  });

  test("sidebar collapses when toggle is clicked", async ({ page }) => {
    const toggleBtn = page.getByRole("button", { name: "Toggle sidebar" });
    await toggleBtn.click();
    await page.waitForTimeout(400);
    // After collapse, sidebar should be narrower
    const sidebarWidth = await page.evaluate(() => {
      const sidebar = document.querySelector(".sidebar") as HTMLElement;
      return sidebar ? sidebar.offsetWidth : 0;
    });
    // Collapsed width token is 56px
    expect(sidebarWidth).toBeLessThanOrEqual(60);

    // Toggle back
    await toggleBtn.click();
    await page.waitForTimeout(400);
  });
});

// ─── Suite 4: Theme Toggle ────────────────────────────────────────────────────

test.describe("Theme Toggle", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    await openProject(page);
  });

  test("toggles from dark to light", async ({ page }) => {
    await setTheme(page, "dark");
    const darkBg = await getToken(page, "--color-bg");
    expect(darkBg).toBe("#09090e");

    const toggleBtn = page.getByRole("button", {
      name: /Switch to light mode|Switch to dark mode/,
    });
    await toggleBtn.click();
    await page.waitForTimeout(200);

    const lightBg = await getToken(page, "--color-bg");
    expect(lightBg).toBe("#ffffff");
  });

  test("toggles back from light to dark", async ({ page }) => {
    // Start in dark, click toggle to light, click again to return to dark
    await setTheme(page, "dark");
    const toggleBtn = page.getByRole("button", {
      name: /Switch to light mode|Switch to dark mode/,
    });
    // First click: dark → light
    await toggleBtn.click();
    await page.waitForTimeout(300);
    const lightBg = await getToken(page, "--color-bg");
    expect(lightBg).toBe("#ffffff");

    // Second click: light → dark
    await toggleBtn.click();
    await page.waitForTimeout(300);
    const darkBg = await getToken(page, "--color-bg");
    expect(darkBg).toBe("#09090e");
  });

  test("light mode sidebar uses white glass", async ({ page }) => {
    await setTheme(page, "light");
    const glassBg = await getToken(page, "--glass-bg");
    expect(glassBg).toContain("255, 255, 255");
  });

  test("light mode borders are indigo-tinted", async ({ page }) => {
    await setTheme(page, "light");
    const glassBorder = await getToken(page, "--glass-border");
    expect(glassBorder).toContain("64, 73, 225");
  });
});

// ─── Suite 5: Glass System ────────────────────────────────────────────────────

test.describe("Glass System", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    await setTheme(page, "dark");
    await openProject(page);
  });

  test("topbar has glass-sm class with SVG filter in DOM", async ({ page }) => {
    // New architecture: backdrop-filter lives on .glass-sm::before pseudo-element
    // Verify the topbar element has the glass class and the filter is mounted
    const result = await page.evaluate(() => {
      const topbar = document.querySelector(".topbar");
      return {
        hasGlassSm: topbar?.classList.contains("glass-sm") ?? false,
        filterExists: !!document.getElementById("lg-refraction"),
        boxShadow: topbar ? getComputedStyle(topbar).boxShadow : "",
      };
    });
    expect(result.hasGlassSm).toBe(true);
    expect(result.filterExists).toBe(true);
    // Topbar bevel shadow confirms glass-sm tier is active
    expect(result.boxShadow).toContain("inset");
  });

  test("topbar has glass border bottom", async ({ page }) => {
    const border = await getComputedProp(page, ".topbar", "border-bottom");
    expect(border).toContain("1px solid");
  });

  test("glass tokens use correct blur values", async ({ page }) => {
    const blurSm = await getToken(page, "--blur-sm");
    const blurMd = await getToken(page, "--blur-md");
    const blurLg = await getToken(page, "--blur-lg");
    expect(blurSm).toBe("6px");
    expect(blurMd).toBe("14px");
    expect(blurLg).toBe("28px");
  });
});

// ─── Suite 6: View Screenshots (Visual Regression Reference) ─────────────────

test.describe("Visual snapshots", () => {
  test("dark mode — project picker", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    await setTheme(page, "dark");
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot("dark-project-picker.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test("dark mode — chat view", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    await setTheme(page, "dark");
    await openProject(page);
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot("dark-chat.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test("dark mode — settings", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    await setTheme(page, "dark");
    await openProject(page);
    await navigateTo(page, "Settings");
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot("dark-settings.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test("dark mode — about", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    await setTheme(page, "dark");
    await openProject(page);
    await navigateTo(page, "About");
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot("dark-about.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test("light mode — chat view", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    await setTheme(page, "light");
    await openProject(page);
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot("light-chat.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test("light mode — settings", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    await setTheme(page, "light");
    await openProject(page);
    await navigateTo(page, "Settings");
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot("light-settings.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test("light mode — about", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    await setTheme(page, "light");
    await openProject(page);
    await navigateTo(page, "About");
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot("light-about.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
});
