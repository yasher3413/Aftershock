import { expect, test } from "./fixtures";
import type { Page, Route } from "@playwright/test";

const TEAMS = ["TOR", "VAN"];

function roster(team: string, base: number) {
  const players = [];
  for (let i = 0; i < 12; i++)
    players.push({
      id: base + i,
      name: `${team} Forward ${i + 1}`,
      position: "F",
      in_lineup: true,
      worth_goals: 8 - i,
    });
  for (let i = 0; i < 6; i++)
    players.push({
      id: base + 20 + i,
      name: `${team} Defence ${i + 1}`,
      position: "D",
      in_lineup: true,
      worth_goals: 5 - i,
    });
  for (let i = 0; i < 2; i++)
    players.push({
      id: base + 30 + i,
      name: `${team} Goalie ${i + 1}`,
      position: "G",
      in_lineup: true,
      worth_goals: 3 - i,
    });
  players.push({
    id: base + 40,
    name: `${team} Hurt`,
    position: "F",
    in_lineup: false,
    worth_goals: 0,
  });
  return { team, games_left: 70, players };
}

const ALL = [
  "ANA",
  "BOS",
  "BUF",
  "CAR",
  "CBJ",
  "CGY",
  "CHI",
  "COL",
  "DAL",
  "DET",
  "EDM",
  "FLA",
  "LAK",
  "MIN",
  "MTL",
  "NJD",
  "NSH",
  "NYI",
  "NYR",
  "OTT",
  "PHI",
  "PIT",
  "SEA",
  "SJS",
  "STL",
  "TBL",
  "TOR",
  "UTA",
  "VAN",
  "VGK",
  "WPG",
  "WSH",
];

function run(encoded: string) {
  const changed = encoded ? TEAMS : [];
  return {
    encoded,
    moves: encoded
      ? [
          {
            player_id: 2000,
            name: "VAN Forward 1",
            move: "trade",
            from_team: "VAN",
            to_team: "TOR",
            weeks: null,
          },
        ]
      : [],
    teams: ALL.map((t, i) => ({
      team: t,
      playoffs_before: t === "TOR" ? 0.41 : t === "VAN" ? 0.38 : 0.5 - i * 0.01,
      playoffs_after: t === "TOR" ? 0.52 : t === "VAN" ? 0.31 : 0.5 - i * 0.01,
      cup_before: 0.03,
      cup_after: t === "TOR" ? 0.05 : 0.03,
      points_before: 92,
      points_after: t === "TOR" ? 96 : t === "VAN" ? 89 : 92,
    })),
    changed,
    why: {
      TOR: [{ player_id: 2000, name: "VAN Forward 1", move: "trade", goals: 7.1 }],
      VAN: [{ player_id: 2000, name: "VAN Forward 1", move: "trade", goals: -7.1 }],
    },
    computed_at: "2026-11-01T12:00:00Z",
  };
}

async function mockRoster(page: Page, opts: { offseason?: boolean } = {}) {
  const runs: string[] = [];
  await page.route("**/api/roster-lab/**", async (route: Route) => {
    const url = new URL(route.request().url());
    if (opts.offseason)
      return route.fulfill({
        status: 409,
        json: { detail: "The Roster Lab returns when the regular season starts." },
      });
    if (url.pathname === "/api/roster-lab/teams/TOR")
      return route.fulfill({ json: roster("TOR", 1000) });
    if (url.pathname === "/api/roster-lab/teams/VAN")
      return route.fulfill({ json: roster("VAN", 2000) });
    if (url.pathname === "/api/roster-lab/free-agents")
      return route.fulfill({
        json: [{ id: 900, name: "Free Agent", position: "F", last_team: "CHI", worth_goals: 2.4 }],
      });
    if (url.pathname === "/api/roster-lab/run") {
      const { encoded } = route.request().postDataJSON() as { encoded: string };
      runs.push(encoded);
      if (encoded.includes("i1030") && encoded.includes("i1031"))
        return route.fulfill({
          status: 422,
          json: { detail: "TOR would have 0 goalies; a team needs at least 2." },
        });
      return route.fulfill({ json: run(encoded) });
    }
    return route.fulfill({ status: 404, json: { detail: "not mocked" } });
  });
  return runs;
}

test("trade a player and see both teams move", async ({ page }) => {
  const runs = await mockRoster(page);
  await page.goto("/roster-lab?teams=TOR,VAN");
  await expect(page.getByRole("heading", { name: "Roster Lab", level: 1 })).toBeVisible();
  await page
    .getByLabel("Move VAN Forward 1", { exact: true })
    .selectOption({ label: "Trade to TOR" });
  await expect(page).toHaveURL(/m=t2000-TOR/);
  await expect.poll(() => runs.at(-1)).toBe("t2000-TOR");
  const tor = page.getByTestId("result-TOR");
  await expect(tor).toContainText("41.0%");
  await expect(tor).toContainText("52.0%");
  await expect(tor).toContainText("VAN Forward 1");
  await expect(page.getByTestId("result-VAN")).toContainText("31.0%");
  // The player now shows on his new team, and can go back.
  const arrived = page.getByTestId("roster-TOR").getByText("VAN Forward 1");
  await expect(arrived).toBeVisible();
  await page.getByRole("button", { name: "Undo move for VAN Forward 1" }).click();
  await expect(page).not.toHaveURL(/m=/);
});

test("an injury has a length, and a refused move says why", async ({ page }) => {
  await mockRoster(page);
  await page.goto("/roster-lab?team=TOR");
  await page.getByLabel("Move TOR Goalie 1").selectOption({ label: "Out 4 weeks" });
  await expect(page).toHaveURL(/m=i1030-4/);
  await page.getByLabel("Move TOR Goalie 2").selectOption({ label: "Out for the season" });
  await expect(page.getByRole("alert")).toContainText("a team needs at least 2");
  // Players already out are listed but cannot be moved.
  await expect(page.getByText("TOR Hurt")).toBeVisible();
  await expect(page.getByLabel("Move TOR Hurt")).toHaveCount(0);
});

test("sign a free agent", async ({ page }) => {
  const runs = await mockRoster(page);
  await page.goto("/roster-lab?team=TOR");
  await page.getByLabel("Find a free agent for TOR").fill("free");
  await page.getByRole("button", { name: "Sign Free Agent to TOR" }).click();
  await expect.poll(() => runs.at(-1)).toBe("s900-TOR");
});

test("offseason shows the note", async ({ page }) => {
  await mockRoster(page, { offseason: true });
  await page.goto("/roster-lab?team=TOR");
  await expect(
    page.getByText("The Roster Lab returns when the regular season starts."),
  ).toBeVisible();
});

test("phone: one column with tabs and no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockRoster(page);
  await page.goto("/roster-lab?teams=TOR,VAN&m=t2000-TOR");
  await expect(page.getByRole("button", { name: "Results" })).toBeVisible();
  await page.getByRole("button", { name: "Results" }).click();
  await expect(page.getByTestId("result-TOR")).toBeVisible();
  await expect(page.getByTestId("roster-TOR")).toBeHidden();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(wide).toBeLessThanOrEqual(390);
});

test("the nav and the What-If Lab link here", async ({ page }) => {
  await mockRoster(page);
  await page.goto("/what-if");
  await page.getByRole("link", { name: "Try a trade in the Roster Lab" }).click();
  await expect(page).toHaveURL(/\/roster-lab/);
  await expect(
    page.getByRole("navigation").getByRole("link", { name: "Roster Lab" }),
  ).toBeVisible();
});
