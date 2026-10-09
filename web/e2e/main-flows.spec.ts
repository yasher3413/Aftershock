import { expect, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.route("**/src/**", (route) => route.continue());
});

test("phone panels support keyboard navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Tonight", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Standings", exact: true })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Standings", exact: true })).toBeVisible();
});

test("initial league failure offers a working retry", async ({ page }) => {
  let failed = true;
  await page.route("**/api/state*", (route) =>
    failed
      ? route.fulfill({ status: 503, json: { detail: "temporarily unavailable" } })
      : route.fallback(),
  );
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Retry connection", exact: true })).toBeVisible({
    timeout: 10000,
  });
  failed = false;
  await page.getByRole("button", { name: "Retry connection", exact: true }).click();
  await expect(page.getByTestId("map").locator("canvas")).toBeVisible({ timeout: 15000 });
});

test("scenario follows browser URL navigation and exposes the win type", async ({ page }) => {
  await page.goto("/what-if?s=2026020009.ar");
  await expect(page.getByText(/seasons in \d+ ms/)).toBeVisible({ timeout: 30000 });
  await page.evaluate(() => {
    history.pushState({}, "", "/what-if?s=2026020009.hr");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByRole("button", { name: /Pick NJD to win in overtime/ })).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 5000 },
  );
  const outcome = page.getByRole("combobox", { name: "Win type for PHI at NJD" });
  await outcome.selectOption("ot");
  await expect(page).toHaveURL(/2026020009\.ho/);
  await page.getByRole("button", { name: "Reset picks", exact: true }).click();
  await expect(page).not.toHaveURL(/s=/);
});

test("a failed background refresh keeps the loaded map available", async ({ page }) => {
  let failed = false;
  let sendResync: (() => void) | undefined;
  await page.route("**/api/state*", (route) =>
    failed
      ? route.fulfill({ status: 503, json: { detail: "temporarily unavailable" } })
      : route.fallback(),
  );
  await page.routeWebSocket("**/ws/live**", (socket) => {
    sendResync = () => socket.send(JSON.stringify({ type: "resync" }));
  });
  await page.goto("/");
  await expect(page.locator("[data-team]")).toHaveCount(32, { timeout: 15000 });
  await expect.poll(() => !!sendResync).toBe(true);
  failed = true;
  sendResync!();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("map").locator("canvas")).toBeVisible({ timeout: 5000 });
  await expect(page.locator("[data-team]")).toHaveCount(32);
});

test("crowded timeline goals remain individually reachable", async ({ page }) => {
  await page.goto("/night/2025-10-16");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "Next goal", exact: true }).click();
  await page.locator('summary[aria-label^="Open tremors:"]').first().click();
  await page.getByRole("button", { name: /Evan Rodrigues/ }).click({ timeout: 5000 });
  await expect(page).toHaveURL(/\/tremor\/17504$/);
});

test("compact phone map keeps every team target inside its viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("[data-team]")).toHaveCount(32, { timeout: 15000 });
  const clipped = await page.locator("[data-team]").evaluateAll((nodes) =>
    nodes
      .filter((node) => {
        const target = node.getBoundingClientRect();
        const map = node.closest('[data-testid="map"]')!.getBoundingClientRect();
        return (
          target.left < map.left ||
          target.top < map.top ||
          target.right > map.right ||
          target.bottom > map.bottom
        );
      })
      .map((node) => node.getAttribute("data-team")),
  );
  expect(clipped).toEqual([]);
});
