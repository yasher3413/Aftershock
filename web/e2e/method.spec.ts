import { test, expect, fixture } from "./fixtures";

// The live Vite server serves /src/api/client.ts; API fixtures must not intercept source modules.
test.beforeEach(async ({ page }) => {
  await page.route("**/src/**", (route) => route.continue());
});

// Losing the retry action would strand readers without the published model evidence.
test("methodology failure keeps the explanation available and can retry evidence", async ({
  page,
}) => {
  let available = false;
  await page.route("**/api/methodology", (route) =>
    route.fulfill({ status: available ? 200 : 503, json: available ? fixture("methodology") : {} }),
  );
  await page.goto("/method");
  await expect(page.getByRole("heading", { name: "How it works", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Model evidence is unavailable right now.")).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("heading", { name: "Known limitations", exact: true }),
  ).toBeAttached();
  available = true;
  await page.getByRole("button", { name: "Retry model evidence" }).click();
  await expect(page.getByText("Model evidence is unavailable right now.")).toBeHidden();
  await page.getByText("Shot model evidence", { exact: true }).click();
  await expect(page.getByText(/On the 2025-26 season it had never seen/)).toBeVisible();
});

// Contents must let a phone reader jump straight to caveats, not just pipeline steps.
test("mobile contents reaches limitations without overflowing the page", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/method");
  await page.locator("summary").filter({ hasText: "On this page" }).click();
  await page
    .getByRole("navigation", { name: "Page contents" })
    .getByRole("link", { name: "Known limitations", exact: true })
    .click();
  await expect(page).toHaveURL(/#limits$/);
  await expect(
    page.getByRole("heading", { name: "Known limitations", exact: true }),
  ).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("the Roster Lab section explains player values with its realism check", async ({ page }) => {
  const roster = {
    alpha: 1000,
    players: 1207,
    top5_full_season_points: [
      ["Zach Werenski", 10.12],
      ["Leon Draisaitl", 9.93],
      ["Nathan MacKinnon", 9.09],
      ["Jordan Spence", 8.85],
      ["Adam Fox", 8.72],
    ],
    fourth_line_swap_points: 3.711,
    fourth_line_swap_median_points: 1.682,
    corr_lineup_vs_goal_diff: 0.797,
    passed: true,
  };
  await page.route("**/api/methodology", (route) =>
    route.fulfill({ json: { ...(fixture("methodology") as object), roster } }),
  );
  await page.goto("/method#roster-lab");
  await expect(
    page.getByRole("heading", { name: "Player values in the Roster Lab" }),
  ).toBeVisible();
  await page.getByText("Roster Lab evidence", { exact: true }).click();
  await expect(page.getByText(/Zach Werenski \(10\.1\)/)).toBeVisible();
  await expect(page.getByText(/typical fourth-line swap moves 1\.7 points/)).toBeVisible();
});
