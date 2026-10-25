import { expect, test } from "./fixtures";
test.beforeEach(async ({ page }) => {
  await page.route("**/src/api/**", (route) => route.continue());
});
const rows = Array.from({ length: 25 }, (_, i) => ({
  rank: i + 1,
  player: { id: 100 + i, name: `Player ${i + 1}` },
  team: i === 24 ? "MTL" : "TOR",
  count: 25 - i,
  value: (25 - i) / 100,
}));
test("saved controls survive reload and Back; search keeps original rank", async ({ page }) => {
  await page.route("**/api/leaders/ppa?**", (route) =>
    route.fulfill({ json: { kind: "assist", season: 20252026, rows } }),
  );
  await page.goto("/leaders?season=20252026&view=assist");
  await expect(page.getByLabel("Season", { exact: true })).toHaveValue("20252026");
  await expect(page.getByRole("button", { name: "Assists", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("link", { name: /^Player / })).toHaveCount(20);
  await page.getByRole("button", { name: /Show more/ }).click();
  await expect(page.getByRole("link", { name: /^Player / })).toHaveCount(25);
  await page.getByLabel("Find a player or team").fill("MTL");
  await expect(page.getByRole("link", { name: /^Player / })).toHaveCount(1);
  await expect(page.getByRole("main").getByRole("list").last().getByRole("listitem")).toContainText(
    "25",
  );
  await page.getByRole("button", { name: "Goals", exact: true }).click();
  await expect(page).toHaveURL(/view=skater/);
  await page.goBack();
  await expect(page.getByRole("button", { name: "Assists", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Assists", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
test("invalid saved controls use current season and failed requests can retry", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/leaders/ppa?**", (route) =>
    route.fulfill(
      fail ? { status: 503, json: {} } : { json: { kind: "skater", season: 20262027, rows } },
    ),
  );
  await page.goto("/leaders?season=bad&view=bad");
  await expect(page.getByLabel("Season", { exact: true })).toHaveValue("20262027");
  await expect(page.getByRole("alert")).toContainText("Could not load Goals");
  await expect(page.getByText("No goals recorded", { exact: false })).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Retry Goals" }).click();
  await expect(page.getByRole("link", { name: "Player 1", exact: true })).toBeVisible();
});

for (const { view, path, name } of [
  { view: "tremors", path: "**/api/tremors?**", name: "Top tremors" },
  { view: "energy", path: "**/api/energy", name: "Season energy" },
  { view: "lottery", path: "**/api/state", name: "Lottery watch" },
]) {
  test(`${name} distinguishes failure from empty data and offers retry`, async ({ page }) => {
    await page.route(path, (route) => route.fulfill({ status: 503, json: {} }));
    await page.goto(`/leaders?season=20252026&view=${view}`);
    await expect(page.getByRole("alert")).toContainText(`Could not load ${name}`);
    await expect(page.getByRole("button", { name: `Retry ${name}` })).toBeVisible();
    if (view === "lottery")
      await expect(
        page.getByText("Lottery watch uses current-season projections", { exact: false }),
      ).toBeVisible();
  });
}

test("switching views keeps the page where it is", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/leaders/ppa?**", (route) =>
    route.fulfill({ json: { kind: "skater", season: 20262027, rows } }),
  );
  await page.goto("/leaders");
  await expect(page.getByRole("link", { name: /^Player / })).toHaveCount(20);
  await page.evaluate(() => window.scrollTo(0, 200));
  await page.getByRole("button", { name: "Assists", exact: true }).click();
  await expect(page).toHaveURL(/view=assist/);
  await expect(page.getByRole("button", { name: "Assists", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(150);
});

test("a row opens its player, and its team code opens the team", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/leaders/ppa?**", (route) =>
    route.fulfill({ json: { kind: "skater", season: 20262027, rows } }),
  );
  await page.goto("/leaders");
  const row = page.getByRole("listitem").filter({ hasText: "Player 3" }).first();
  await row.getByRole("link", { name: "TOR" }).click();
  await expect(page).toHaveURL(/\/team\/TOR/);
  await page.goBack();
  await expect(page.getByRole("link", { name: /^Player / })).toHaveCount(20);
  await row.scrollIntoViewIfNeeded();
  const box = (await row.boundingBox())!;
  await page.mouse.click(box.x + box.width - 20, box.y + box.height / 2);
  await expect(page).toHaveURL(/\/player\/102/);
});
