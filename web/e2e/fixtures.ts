import { test as base, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Recorded real API responses (see scripts/capture_e2e_fixtures.py). */
export function fixture(name: string): unknown {
  return JSON.parse(
    gunzipSync(readFileSync(join(here, "fixtures", `${name}.json.gz`))).toString("utf8"),
  );
}

export async function mockApi(page: Page): Promise<void> {
  const state = fixture("state") as { replay: { night_date: string } };
  const routes: Record<string, unknown> = {
    "/api/state": state,
    [`/api/replay/${state.replay.night_date}`]: fixture("replay"),
    "/api/teams/MTL": fixture("team-MTL"),
    "/api/whatif/bootstrap": fixture("whatif"),
    "/api/methodology": fixture("methodology"),
    "/api/games": fixture("games-2026-09-30"),
    "/api/replay/nights": fixture("nights-20252026"),
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = routes[path];
    if (body === undefined)
      return route.fulfill({ status: 404, json: { detail: "not in fixtures" } });
    return route.fulfill({ status: 200, json: body });
  });
  // No live socket in tests: the page falls back to its replay.
  await page.routeWebSocket("**/ws/live**", (ws) => ws.close());
}

export const test = base.extend<{ mocked: void }>({
  mocked: [
    async ({ page }, use) => {
      await mockApi(page);
      await use();
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
