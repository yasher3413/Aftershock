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
    bumped: encoded ? { TOR: [{ player_id: 1011, name: "TOR Forward 12" }] } : {},
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

test("build a trade, then see its results", async ({ page }) => {
  const runs = await mockRoster(page);
  await page.goto("/roster-lab?teams=TOR,VAN");
  await expect(page.getByRole("heading", { name: "Roster Lab", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Add a VAN player to the trade" }).click();
  await page.getByLabel("Find a VAN player").fill("forward 1");
  await page.getByRole("button", { name: "Trade VAN Forward 1 to TOR" }).click();
  await expect(page).toHaveURL(/m=t2000-TOR/);
  await expect(page.getByTestId("sends-VAN")).toContainText("VAN Forward 1");
  // Nothing runs until asked.
  expect(runs).toEqual([]);
  await page.getByRole("button", { name: "See trade results" }).click();
  await expect.poll(() => runs.at(-1)).toBe("t2000-TOR");
  const tor = page.getByTestId("result-TOR");
  await expect(tor).toContainText("41.0%");
  await expect(tor).toContainText("52.0%");
  await expect(tor).toContainText("VAN Forward 1");
  await expect(tor).toContainText("TOR Forward 12");
  await expect(page.getByTestId("result-VAN")).toContainText("31.0%");
  await page.getByRole("button", { name: "Remove VAN Forward 1 from the trade" }).click();
  await expect(page).not.toHaveURL(/m=/);
});

test("a two-for-one trade runs, and an edit asks for a rerun", async ({ page }) => {
  const runs = await mockRoster(page);
  await page.goto("/roster-lab?teams=TOR,VAN");
  for (const [team, name, to] of [
    ["VAN", "VAN Forward 1", "TOR"],
    ["VAN", "VAN Defence 2", "TOR"],
    ["TOR", "TOR Forward 3", "VAN"],
  ]) {
    await page.getByRole("button", { name: `Add a ${team} player to the trade` }).click();
    await page.getByRole("button", { name: `Trade ${name} to ${to}`, exact: true }).click();
  }
  await page.getByRole("button", { name: "See trade results" }).click();
  await expect.poll(() => runs.at(-1)).toBe("t1002-VAN_t2000-TOR_t2021-TOR");
  await expect(page.getByTestId("result-TOR")).toBeVisible();
  await page.getByRole("button", { name: "Remove TOR Forward 3 from the trade" }).click();
  await expect(page.getByText("The trade changed.")).toBeVisible();
  await page.getByRole("button", { name: "See trade results" }).click();
  await expect.poll(() => runs.at(-1)).toBe("t2000-TOR_t2021-TOR");
});

test("an injury has a length, and a refused trade says why", async ({ page }) => {
  await mockRoster(page);
  await page.goto("/roster-lab?team=TOR");
  for (const name of ["TOR Goalie 1", "TOR Goalie 2"]) {
    await page.getByRole("button", { name: "Take a TOR player out" }).click();
    await page.getByRole("button", { name: `Take ${name} out`, exact: true }).click();
  }
  await page.getByLabel("How long TOR Goalie 1 is out").selectOption({ label: "Out 4 weeks" });
  await page
    .getByLabel("How long TOR Goalie 2 is out")
    .selectOption({ label: "Out for the season" });
  await expect(page).toHaveURL(/m=i1030-4_i1031-0/);
  await page.getByRole("button", { name: "See trade results" }).click();
  await expect(page.getByRole("alert")).toContainText("a team needs at least 2");
  // Players out of the lineup lately cannot be picked.
  await page.getByRole("button", { name: "Take a TOR player out" }).click();
  await expect(page.getByRole("button", { name: "Take TOR Hurt out" })).toHaveCount(0);
});

test("either team can be changed, and moves with the old team go", async ({ page }) => {
  await mockRoster(page);
  await page.route("**/api/roster-lab/teams/MTL", (route) =>
    route.fulfill({ json: roster("MTL", 3000) }),
  );
  await page.goto("/roster-lab?teams=TOR,VAN&m=t2000-TOR_i1001-2");
  await page.getByLabel("Trade partner", { exact: true }).selectOption("MTL");
  await expect(page).toHaveURL(/teams=TOR%2CMTL&m=i1001-2$/);
  await page.getByLabel("Team", { exact: true }).selectOption("VAN");
  await expect(page).toHaveURL(/teams=VAN%2CMTL$/);
  await expect(page.getByLabel("Team", { exact: true })).toHaveValue("VAN");
});

test("a shared trade shows its results straight away", async ({ page }) => {
  const runs = await mockRoster(page);
  await page.goto("/roster-lab?teams=TOR,VAN&m=t2000-TOR");
  await expect(page.getByTestId("result-TOR")).toContainText("52.0%");
  expect(runs).toEqual(["t2000-TOR"]);
});

test("offseason shows the note", async ({ page }) => {
  await mockRoster(page, { offseason: true });
  await page.goto("/roster-lab?team=TOR");
  await expect(
    page.getByText("The Roster Lab returns when the regular season starts."),
  ).toBeVisible();
});

test("phone: one column and no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockRoster(page);
  await page.goto("/roster-lab?teams=TOR,VAN&m=t2000-TOR");
  await expect(page.getByTestId("result-TOR")).toBeVisible();
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
