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
