import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

for (const path of ["/", "/team/MTL", "/what-if", "/method", "/nights?season=20252026"]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`no serious accessibility violations on ${path} (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(path);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(1500);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      const serious = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      const summary = serious.map(
        (v) =>
          `${v.id}: ${v.nodes
            .slice(0, 3)
            .map((n) => n.target.join(" "))
            .join(", ")}`,
      );
      expect(summary).toEqual([]);
    });
  }
}
