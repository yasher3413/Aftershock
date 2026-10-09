import { expect, test } from "./fixtures";

test.describe("first visit", () => {
  test.use({ freshVisitor: true });

  test("the walkthrough opens once, steps through the real page, and stays dismissed", async ({
    page,
  }) => {
    await page.goto("/");
    const tour = page.getByRole("dialog");
    // The tour waits for the map to load, like a visitor would.
    await expect(tour).toContainText("Every goal moves the playoff race", { timeout: 15_000 });
    await expect(tour).toContainText("you're watching October 16 again");
    await tour.getByRole("button", { name: "Show me around" }).click();
    await expect(tour).toContainText("Each ring is a team's playoff odds");
    await expect(tour).toContainText("2 of 7");
    // Keyboard: right moves on, left goes back.
    await page.keyboard.press("ArrowRight");
    await expect(tour).toContainText("A goal sends out a shockwave");
    await page.keyboard.press("ArrowLeft");
    await expect(tour).toContainText("Each ring is a team's playoff odds");
    // The page stays usable under the tour.
    await page.getByRole("button", { name: "60x" }).click();
    await expect(page.getByRole("button", { name: "60x" })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(tour).toBeHidden();
    await page.reload();
    await expect(page.getByTestId("map").locator("canvas")).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("the last step points at the other pages and closes the tour", async ({ page }) => {
    await page.goto("/");
    const tour = page.getByRole("dialog");
    await expect(tour).toBeVisible({ timeout: 15_000 });
    for (let i = 0; i < 6; i++)
      await tour.getByRole("button", { name: /Show me around|Next/ }).click();
    await expect(tour).toContainText("There's more to explore");
    await tour.getByRole("button", { name: "Start watching" }).click();
    await expect(tour).toBeHidden();
  });
});

test("a returning visitor can replay the tour", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("map").locator("canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "How to read this" }).click();
  await expect(page.getByRole("dialog")).toContainText("Every goal moves the playoff race");
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});
