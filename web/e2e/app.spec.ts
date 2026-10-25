import { expect, test } from "./fixtures";

test("demo mode replays a night and a tremor lands within 30 seconds at 60x", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("October 16, replayed");
  await expect(page.getByText("No games are on, so the map is replaying")).toBeVisible();
  await expect(page.getByTestId("map").locator("canvas")).toBeVisible();
  await page.getByRole("button", { name: "60x" }).click();
  await expect(page.locator('[aria-label^="Open tremor"]').first()).toBeAttached({
    timeout: 30_000,
  });
  await expect(page.getByRole("status").filter({ hasText: "Magnitude" })).toContainText("Goal,");
});

test("keyboard navigation reaches every team node", async ({ page }) => {
  await page.goto("/");
  // The map draws after the league loads, which can take a while when the
  // suite runs many pages in parallel.
  await expect(page.locator("[data-team]")).toHaveCount(32, { timeout: 30_000 });
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

test("picking a team in the What-If Lab changes the odds", async ({ page }) => {
  await page.goto("/what-if");
  await expect(page.getByText(/seasons in \d+ ms/)).toBeVisible({ timeout: 30_000 });
  const changes = page.locator("tbody td:nth-child(3)");
  // With no picks there is nothing to compare, so the change column waits.
  await expect(page.getByRole("columnheader", { name: "Change (pp)" })).toHaveCount(0);
  // Home team: regulation, then overtime; the away team takes over in regulation.
  const home = page.locator('button[aria-label*="Not decided"]').nth(1);
  const name = (await home.getAttribute("aria-label"))!.match(/Pick (\w+) to win/)![1]!;
  await home.click();
  await expect(page).toHaveURL(/s=\d+\.hr/);
  await page.getByRole("button", { name: new RegExp(`Pick ${name} to win in overtime`) }).click();
  await expect(page).toHaveURL(/s=\d+\.ho/);
  await page
    .getByRole("button", { name: /to win in regulation/ })
    .first()
    .click();
  await expect(page).toHaveURL(/s=\d+\.ar/);
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

test("a night without a replay shows its schedule", async ({ page }) => {
  await page.goto("/night/2026-09-30");
  await expect(page.getByRole("heading", { name: "September 30, 2026" })).toBeVisible();
  await expect(page.getByText("The replay appears here once every game is final")).toBeVisible();
  await expect(page.locator('a[href^="/game/"]')).toHaveCount(3);
  await expect(page.getByText("PHI 55% to win")).toBeVisible();
});

test("the nights calendar opens a past night", async ({ page }) => {
  await page.goto("/nights?season=20252026");
  await expect(page.getByRole("heading", { name: "Every night" })).toBeVisible();
  await expect(page.getByRole("region", { name: "October 2025" })).toBeVisible();
  await page.getByRole("link", { name: /^October 16, 2025:/ }).click();
  await expect(page).toHaveURL(/\/night\/2025-10-16$/);
  await expect(page.getByRole("link", { name: "All nights" })).toBeVisible();
});

test("a player card shows the season and links each goal", async ({ page }) => {
  await page.goto("/player/8481540");
  await expect(page.getByRole("heading", { name: "Cole Caufield" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Biggest goals" })).toBeVisible();
  await expect(page.getByText("Goal PPA", { exact: true })).toBeVisible();
  const goal = page
    .getByRole("group", { name: /Goals over the season/ })
    .getByRole("link")
    .first();
  await goal.click();
  await expect(page).toHaveURL(/\/tremor\/\d+$/);
});

test("night replay can skip quiet time and restart without leaving the page", async ({ page }) => {
  await page.goto("/night/2025-10-16");
  await expect(page.getByRole("slider", { name: "Replay position" })).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const position = page.getByRole("slider", { name: "Replay position" });
  await page.getByRole("button", { name: "Next goal", exact: true }).click({ timeout: 5000 });
  await expect(page.locator('[aria-label^="Open tremor"]').first()).toBeAttached();
  expect(Number(await position.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
  // Next goal and Restart keep playing, so the goal's shockwave shows.
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  const before = Number(await position.getAttribute("aria-valuenow"));
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await expect
    .poll(async () => Number(await position.getAttribute("aria-valuenow")))
    .toBeLessThan(before);
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Standings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Standings", exact: true })).toBeVisible();
});

test("picking a team on a phone does not move the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/what-if");
  await expect(page.getByText(/seasons in \d+ ms/)).toBeVisible({ timeout: 30_000 });
  const bar = page.locator(".sticky.top-0").first();
  const heights = new Set<number>();
  const track = async () => heights.add(Math.round((await bar.boundingBox())!.height));
  await track();
  const pick = page.locator('button[aria-label*="Not decided"]').nth(1);
  await pick.click();
  for (let i = 0; i < 15; i++) {
    await track();
    await page.waitForTimeout(60);
  }
  await expect(page.getByRole("button", { name: "Share scenario" })).toBeEnabled();
  await track();
  expect([...heights]).toHaveLength(1);
});

test("on a laptop the picks and the forecast scroll together", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/what-if");
  await expect(page.getByText(/seasons in \d+ ms/)).toBeVisible({ timeout: 30_000 });
  const games = page.locator("#scenario-games");
  const forecast = page.locator("#scenario-results");
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(200);
  const before = (await games.boundingBox())!.y;
  const box = (await forecast.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, 500);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(400);
  expect((await games.boundingBox())!.y).toBeLessThan(before - 300);
});

test("on a phone the What-If Lab shows picks, forecast, and bracket one at a time", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/what-if");
  await expect(page.getByText(/seasons in \d+ ms/)).toBeVisible({ timeout: 30_000 });
  const views = page.getByRole("group", { name: "Show" });
  const games = page.locator("#scenario-games");
  const forecast = page.locator("#scenario-results");
  const bracket = page.getByRole("heading", { name: "Projected playoff bracket" });
  await expect(games).toBeVisible();
  await expect(forecast).toBeHidden();
  await views.getByRole("button", { name: "Forecast" }).click();
  await expect(forecast).toBeVisible();
  await expect(games).toBeHidden();
  await views.getByRole("button", { name: "Bracket" }).click();
  await expect(bracket).toBeVisible();
  await expect(forecast).toBeHidden();
  await views.getByRole("button", { name: "Picks" }).click();
  await expect(games).toBeVisible();
  // Everything still sits side by side on a laptop.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(forecast).toBeVisible();
  await expect(bracket).toBeVisible();
  await expect(views).toBeHidden();
});
