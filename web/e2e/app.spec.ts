import { expect, test } from "./fixtures";

test("demo mode replays a night and a tremor lands within 30 seconds at 60x", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("note")).toContainText("Replaying October 16, 2025");
  await expect(page.getByTestId("map").locator("canvas")).toBeVisible();
  await page.getByRole("button", { name: "60x" }).click();
  await expect(page.locator('[aria-label^="Open tremor"]').first()).toBeAttached({
    timeout: 30_000,
  });
  await expect(page.getByRole("status").filter({ hasText: "Magnitude" })).toContainText("Goal,");
});

test("keyboard navigation reaches every team node", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-team]")).toHaveCount(32);
  const seen = new Set<string>();
  for (let i = 0; i < 80 && seen.size < 32; i++) {
    await page.keyboard.press("Tab");
    const team = await page.evaluate(() => document.activeElement?.getAttribute("data-team"));
    if (team) seen.add(team);
  }
  expect(seen.size).toBe(32);
  await expect(page.getByRole("tooltip")).toBeVisible();
});

test("team page renders the rooting guide", async ({ page }) => {
  await page.goto("/team/MTL");
  await expect(page.getByRole("heading", { name: "Montreal Canadiens" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Who to root for this week" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Odds over the season" })).toBeVisible();
});

test("toggling a game in the What-If Lab changes the odds", async ({ page }) => {
  await page.goto("/what-if");
  await expect(page.getByText(/seasons in \d+ ms/)).toBeVisible({ timeout: 30_000 });
  const changes = page.locator("tbody td:nth-child(3)");
  await expect(changes.first()).toHaveText(/0\.0 pp/);
  await page.locator('button[aria-label*="Not decided"]').first().click();
  await expect(page).toHaveURL(/s=\d+\.hr/);
  await expect(async () => {
    const texts = await changes.allInnerTexts();
    expect(texts.some((t) => !/^0\.0 pp$/.test(t.trim()))).toBe(true);
  }).toPass({ timeout: 15_000 });
});

test("reduced motion shows no rings or shake", async ({ browser }) => {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const { mockApi } = await import("./fixtures");
  await mockApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "60x" }).click();
  await expect(page.locator('[aria-label^="Open tremor"]').first()).toBeAttached({
    timeout: 30_000,
  });
  // No live-venue pulse animation, and the map canvas never shifts (no shake).
  await expect(page.locator(".live-pulse")).toHaveCount(0);
  const box = await page.getByTestId("map").locator("canvas").boundingBox();
  await page.waitForTimeout(400);
  expect(await page.getByTestId("map").locator("canvas").boundingBox()).toEqual(box);
  const animations = await page.evaluate(
    () => document.getAnimations().filter((a) => a.playState === "running").length,
  );
  expect(animations).toBe(0);
  await context.close();
});
