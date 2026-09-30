/**
 * README media. Runs against a live stack (SCREENSHOT_URL, default the dev
 * server), not the fixtures: `make screenshots`.
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.SCREENSHOT_URL ?? "http://127.0.0.1:5173";
const OUT = "../docs/media";
const NIGHT = process.env.SCREENSHOT_NIGHT ?? "2026-04-09";

test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to capture README media");
test.describe.configure({ mode: "serial" });
mkdirSync(OUT, { recursive: true });

async function waitForTremor(page: Page) {
  await page.getByRole("button", { name: "60x" }).click();
  await expect(page.locator('[aria-label^="Open tremor"]').first()).toBeAttached({
    timeout: 90_000,
  });
}

test("hero video of a night", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 760 },
    recordVideo: { dir: `${OUT}/raw`, size: { width: 1280, height: 760 } },
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/night/${NIGHT}`);
  await page.getByRole("button", { name: "20x" }).click();
  await page.waitForTimeout(3000);
  await waitForTremor(page);
  await page.waitForTimeout(14_000);
  await context.close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`home mid-tremor (${scheme})`, async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      colorScheme: scheme,
    });
    await page.goto(`${BASE}/night/${NIGHT}`);
    await waitForTremor(page);
    await page.waitForTimeout(650);
    await page.screenshot({ path: `${OUT}/night-${scheme}.png` });
  });
}

const pages: [string, string, { w: number; h: number; full?: boolean }][] = [
  ["team", "/team/MTL", { w: 1280, h: 900, full: true }],
  ["what-if", "/what-if", { w: 1280, h: 900 }],
  ["leaders", "/leaders", { w: 1280, h: 900 }],
  ["method", "/method", { w: 1280, h: 900 }],
];
for (const [name, path, size] of pages) {
  test(`page ${name}`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: size.w, height: size.h } });
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    if (name === "what-if")
      await expect(page.getByText(/seasons in/)).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: size.full ?? false });
  });
}

test("mobile home", async ({ browser }) => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  await page.goto(`${BASE}/night/${NIGHT}`);
  await waitForTremor(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/mobile.png` });
});
