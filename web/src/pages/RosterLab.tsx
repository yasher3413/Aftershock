import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { api, ApiError, useStateQuery } from "../api/client";
import type {
  FreeAgent,
  RosterPlayer,
  RosterRunOut,
  RosterTeamLine,
  RosterTeamResponse,
} from "../api/types.gen";
import { TeamLogo } from "../components/TeamLogo";
import { ShareMenu } from "../components/ShareMenu";
import { pct, pp } from "../lib/format";
import { useDocumentMeta } from "../lib/meta";
import { useMedia } from "../lib/useMedia";
import {
  WEEKS,
  encodeMoves,
  headline,
  outLabel,
  parseMoves,
  withMove,
  type Move,
} from "../roster/moves";
import { rosterShare } from "../roster/share";

const GROUPS = [
  { pos: "F", label: "Forwards" },
  { pos: "D", label: "Defence" },
  { pos: "G", label: "Goalies" },
] as const;
type View = "rosters" | "results";
const VIEWS: { id: View; label: string }[] = [
  { id: "rosters", label: "Rosters" },
  { id: "results", label: "Results" },
];

function goals(x: number): string {
  const v = Number(x.toFixed(1));
  if (v === 0) return "0.0";
  return `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;
}

/** The message a refused or failed request should show. */
function problem(error: unknown): { text: string; offseason: boolean; retry: boolean } | null {
  if (!error) return null;
  if (error instanceof ApiError) {
    if (error.status === 409) return { text: error.detail ?? "", offseason: true, retry: false };
    if (error.status === 422 && error.detail)
      return { text: error.detail, offseason: false, retry: false };
    if (error.status === 503)
      return {
        text: "The forecast is still being built. Try again in a minute.",
        offseason: false,
        retry: true,
      };
  }
  return { text: "The Roster Lab could not reach the forecast.", offseason: false, retry: true };
}

export default function RosterLabPage() {
  useDocumentMeta(
    "Roster Lab",
    "Trade players, take one out for a few weeks, or sign a free agent, and see how far each team's playoff and Stanley Cup odds move.",
  );
  const state = useStateQuery();
  const teamsInfo = useMemo(
    () => Object.fromEntries((state.data?.teams ?? []).map((t) => [t.abbrev, t])),
    [state.data],
  );
  const [params, setParams] = useSearchParams();
  const moves = useMemo(() => parseMoves(params.get("m")), [params]);
  const encoded = encodeMoves(moves);
  const [lastMoves, setLastMoves] = useState<string | null>(null);

  const update = (next: (p: URLSearchParams) => void) =>
    setParams(
      (current) => {
        const result = new URLSearchParams(current);
        next(result);
        return result;
      },
      // Moves live in the address so a trade can be shared; keep the page where it is.
      { replace: true, preventScrollReset: true },
    );
  const setMoves = (next: Move[]) => {
    setLastMoves(encoded);
    update((p) => {
      const e = encodeMoves(next);
      if (e) p.set("m", e);
      else p.delete("m");
    });
  };

  // A short share link (/roster-lab?id=...) names saved moves: swap them in.
  const sharedId = params.get("id");
  const [sharedMissing, setSharedMissing] = useState(false);
  useEffect(() => {
    if (!sharedId) return;
    let live = true;
    api<{ encoded: string }>(`/roster-moves/${encodeURIComponent(sharedId)}`)
      .then(
        (r) => r.encoded,
        () => null,
      )
      .then((saved) => {
        if (!live) return;
        setSharedMissing(!saved);
        update((p) => {
          p.delete("id");
          if (saved) p.set("m", saved);
        });
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedId]);

  const run = useQuery({
    queryKey: ["roster-run", encoded],
    queryFn: () =>
      api<RosterRunOut>("/roster-lab/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encoded }),
      }),
    enabled: encoded !== "",
    placeholderData: keepPreviousData,
    staleTime: 300_000,
    retry: false,
  });
  const result = encoded && run.data ? run.data : null;
  const updating = run.isFetching;

  // The teams on screen: the ones chosen, then any a shared trade involves.
  const chosen = (params.get("teams") ?? params.get("team") ?? "")
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter((t) => /^[A-Z]{3}$/.test(t));
  const fromRun = (result?.moves ?? []).flatMap((m) => [m.from_team, m.to_team]);
  const teams = [...new Set([...chosen, ...fromRun.filter((t): t is string => !!t)])].slice(0, 2);
  const setTeams = (next: string[]) =>
    update((p) => {
      p.delete("team");
      const list = next.filter(Boolean);
      if (list.length) p.set("teams", list.join(","));
      else p.delete("teams");
    });

  const rosters = useQueries({
    queries: teams.map((t) => ({
      queryKey: ["roster-team", t],
      queryFn: () => api<RosterTeamResponse>(`/roster-lab/teams/${t}`),
      staleTime: 300_000,
      retry: false,
    })),
  });
  const rosterBy: Record<string, RosterTeamResponse | undefined> = Object.fromEntries(
    teams.map((t, i) => [t, rosters[i]?.data]),
  );

  // Names of everyone a move can mention.
  const [agents, setAgents] = useState<Record<number, FreeAgent>>({});
  const players: Record<number, { name: string; position: string; team: string | null }> = {};
  for (const t of teams)
    for (const p of rosterBy[t]?.players ?? [])
      players[p.id] = { name: p.name, position: p.position, team: t };
  for (const a of Object.values(agents))
    players[a.id] ??= { name: a.name, position: a.position, team: null };
  for (const m of result?.moves ?? [])
    players[m.player_id] ??= { name: m.name, position: "F", team: m.from_team ?? null };

  const stacked = useMedia("(max-width: 1023px)");
  const [view, setView] = useState<View>("rosters");
  const barTop = useRef<HTMLDivElement>(null);
  const show = (v: View) => {
    setView(v);
    // Start the new view at its top, just under the summary bar.
    const top = (barTop.current?.getBoundingClientRect().top ?? 0) + window.scrollY;
    if (window.scrollY > top) window.scrollTo({ top, behavior: "auto" });
  };

  const offseason = [run.error, ...rosters.map((r) => r.error)]
    .map(problem)
    .find((p) => p?.offseason);
  const runProblem = problem(run.error);
  const rosterProblem = rosters.map((r) => problem(r.error)).find((p) => p && !p.offseason);

  const changed = (result?.changed ?? [])
    .map((t) => result!.teams.find((x) => x.team === t))
    .filter((t): t is RosterTeamLine => !!t);
  const words = result
    ? headline(result.moves)
    : headline(
        moves.map((m) => ({
          name: players[m.id]?.name ?? "A player",
          move: m.kind === "i" ? "injury" : m.kind === "s" ? "sign" : "trade",
          to_team: m.kind === "i" ? null : m.to,
          weeks: m.kind === "i" ? m.weeks : null,
        })),
      );

  if (offseason)
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <h1 className="display text-[44px] font-extrabold">Roster Lab</h1>
        <p className="mt-3 text-ink-soft">{offseason.text}</p>
        <p className="mt-3 text-[14px]">
          <Link to="/standings" className="font-semibold text-blue-line hover:underline">
            See the final standings
          </Link>
        </p>
      </div>
    );

  const allTeams = [...(state.data?.teams ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 [overflow-anchor:none] md:px-6 md:py-10">
      <h1 className="display text-[38px] font-extrabold leading-none sm:text-[60px]">Roster Lab</h1>
      <p className="mt-2 max-w-[62ch] text-[14px] text-ink-soft">
        Trade players between two teams, take one out for a few weeks, or sign a free agent. The
        season reruns 10,000 times before and after, so you can see what one player is worth.{" "}
        <Link to="/what-if" className="font-semibold text-blue-line hover:underline">
          Pick game results in the What-If Lab
        </Link>
      </p>
      {sharedMissing && (
        <p role="status" className="mt-2 text-[14px] font-semibold">
          That shared trade could not be found. Make your own below.
        </p>
      )}

      <div className="mt-5 grid gap-3 text-[13px] sm:grid-cols-2 lg:max-w-[42rem]">
        {[0, 1].map((i) => (
          <label key={i} className="flex flex-col gap-1 text-ink-soft">
            {i === 0 ? "Team" : "Trade partner"}
            <select
              value={teams[i] ?? ""}
              onChange={(e) => {
                const next = [...teams];
                next[i] = e.target.value;
                setTeams(next);
              }}
              className="min-h-[44px] rounded-[var(--radius)] border border-ice-scratch bg-surface px-3 py-2 text-[14px] text-ink"
            >
              <option value="">{i === 0 ? "Choose a team" : "None (injuries and signings)"}</option>
              {allTeams
                .filter((t) => t.abbrev !== teams[1 - i])
                .map((t) => (
                  <option key={t.abbrev} value={t.abbrev}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
        ))}
      </div>

      <div ref={barTop} aria-hidden />
      <div className="sticky top-0 z-20 mt-5 flex flex-wrap items-center justify-between gap-3 border-y-2 border-ink bg-surface px-4 py-3">
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="truncate text-[14px] font-semibold">
            {moves.length ? words : "No moves yet: choose a player below"}
          </p>
          <p className="mt-1 truncate text-[13px] text-ink-soft">
            {updating
              ? "Rerunning the season"
              : changed.length
                ? changed
                    .map(
                      (t) =>
                        `${t.team} ${pct(t.playoffs_before)} to ${pct(t.playoffs_after)} playoffs`,
                    )
                    .join(", ")
                : "Odds before and after appear here."}
          </p>
        </div>
        <div className="flex w-full gap-2 lg:w-auto">
          {stacked && (
            <div role="group" aria-label="Show" className="flex flex-1 gap-1">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={view === v.id}
                  onClick={() => show(v.id)}
                  className={`min-h-[44px] flex-1 rounded-[var(--radius)] px-2 text-[13px] font-semibold ${view === v.id ? "bg-ink text-ice" : "text-ink-soft ring-1 ring-ice-scratch ring-inset"}`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            disabled={moves.length === 0}
            onClick={() => setMoves([])}
            className="min-h-[44px] shrink-0 whitespace-nowrap rounded-[var(--radius)] border border-ice-scratch px-3 text-[13px] font-semibold disabled:opacity-50"
          >
            Reset
          </button>
          {result && <ShareMenu spec={rosterShare(result)} disabled={updating} compact={stacked} />}
        </div>
      </div>

      {runProblem && (
        <div role="alert" className="mt-3 border-b border-ice-scratch pb-3 text-[14px]">
          <span className="font-semibold">{runProblem.text}</span>{" "}
          {lastMoves !== null && !runProblem.retry && (
            <button
              type="button"
              onClick={() => setMoves(parseMoves(lastMoves))}
              className="min-h-[44px] font-semibold text-blue-line underline"
            >
              Undo last move
            </button>
          )}
          {runProblem.retry && (
            <button
              type="button"
              onClick={() => void run.refetch()}
              className="min-h-[44px] font-semibold text-blue-line underline"
            >
              Try again
            </button>
          )}
        </div>
      )}

      <div className="mt-6 grid items-start gap-8 lg:grid-cols-[1.15fr_1fr]">
        <section
          aria-label="Rosters"
          className={`${!stacked || view === "rosters" ? "" : "hidden"} grid gap-10`}
        >
          {teams.length === 0 && (
            <p className="border-y border-ice-scratch py-6 text-ink-soft">
              Choose a team to see its roster. Add a trade partner to move players between them.
            </p>
          )}
          {rosterProblem && (
            <p role="alert" className="text-[14px] font-semibold">
              {rosterProblem.text}
            </p>
          )}
          {teams.map((t) => (
            <TeamRoster
              key={t}
              team={t}
              name={teamsInfo[t]?.name ?? t}
              partner={teams.find((x) => x !== t) ?? null}
              data={rosterBy[t]}
              moves={moves}
              players={players}
              onMove={(next) => setMoves(withMove(moves, next))}
              onAgent={(a) => setAgents((m) => ({ ...m, [a.id]: a }))}
            />
          ))}
        </section>

        <section
          aria-label="Odds before and after"
          className={`${!stacked || view === "results" ? "" : "hidden"} lg:sticky lg:top-28`}
        >
          <div className="flex min-h-[56px] items-end border-b-2 border-ink pb-3">
            <h2 className="display text-[30px] font-bold">Before and after</h2>
          </div>
          {!result && (
            <p className="mt-3 text-[13px] text-ink-soft">
              Make a move to rerun the season. Each team's playoff odds, Stanley Cup odds, and
              projected points show here before and after.
            </p>
          )}
          {result && (
            <Results result={result} changed={changed} updating={updating} names={teamsInfo} />
          )}
        </section>
      </div>
    </div>
  );
}

function TeamRoster({
  team,
  name,
  partner,
  data,
  moves,
  players,
  onMove,
  onAgent,
}: {
  team: string;
  name: string;
  partner: string | null;
  data: RosterTeamResponse | undefined;
  moves: Move[];
  players: Record<number, { name: string; position: string; team: string | null }>;
  onMove: (next: Move | { kind: "none"; id: number }) => void;
  onAgent: (a: FreeAgent) => void;
}) {
  const moveOf = Object.fromEntries(moves.map((m) => [m.id, m]));
  const arrivals = moves.filter((m) => m.kind !== "i" && m.to === team);
  const out = (data?.players ?? []).filter((p) => !p.in_lineup);
  return (
    <div data-testid={`roster-${team}`}>
      <div className="flex min-h-[56px] items-end gap-3 border-b-2 border-ink pb-3">
        <h2 className="display flex items-center gap-2 text-[30px] font-bold leading-none">
          <TeamLogo team={team} size={32} />
          {name}
        </h2>
      </div>
      {!data && <p className="mt-3 text-[13px] text-ink-soft">Loading the roster</p>}
      {data && (
        <>
          <p className="mt-3 text-[13px] text-ink-soft">
            Worth is a player's goal difference for {team} over its {data.games_left} remaining
            games.
          </p>
          {GROUPS.map((g) => {
            const own = data.players.filter((p) => p.in_lineup && p.position === g.pos);
            const incoming = arrivals.filter((m) => (players[m.id]?.position ?? "F") === g.pos);
            return (
              <div key={g.pos} className="mt-5">
                <div className="flex items-end justify-between border-b border-ink pb-1">
                  <h3 className="text-[15px] font-semibold">{g.label}</h3>
                  <span className="text-[12px] text-ink-soft">Worth, goals</span>
                </div>
                <ul className="divide-y divide-ice-scratch">
                  {own.map((p) => (
                    <PlayerRow
                      key={p.id}
                      p={p}
                      team={team}
                      partner={partner}
                      move={moveOf[p.id]}
                      onMove={onMove}
                    />
                  ))}
                  {incoming.map((m) => (
                    <li
                      key={m.id}
                      className="grid min-h-[48px] grid-cols-[1fr_auto] items-center gap-3 py-1"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-semibold">
                          {players[m.id]?.name ?? "A player"}
                        </span>
                        <span className="text-[12px] font-semibold text-blue-line">
                          {m.kind === "s"
                            ? "Signed as a free agent"
                            : `From ${players[m.id]?.team ?? "another team"}`}
                        </span>
                      </span>
                      {m.kind === "s" && (
                        <button
                          type="button"
                          aria-label={`Undo move for ${players[m.id]?.name ?? "this player"}`}
                          onClick={() => onMove({ kind: "none", id: m.id })}
                          className="min-h-[44px] px-2 text-[13px] font-semibold text-blue-line"
                        >
                          Undo
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {out.length > 0 && (
            <div className="mt-5">
              <h3 className="border-b border-ink pb-1 text-[15px] font-semibold">
                Not playing lately
              </h3>
              <p className="mt-2 text-[12px] text-ink-soft">
                Out of the lineup in recent games. The forecast already plays without them, so they
                cannot be moved here.
              </p>
              <ul className="mt-1 text-[13px] text-ink-soft">
                {out.map((p) => (
                  <li key={p.id} className="py-1">
                    {p.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <FreeAgentSearch team={team} moves={moves} onMove={onMove} onAgent={onAgent} />
        </>
      )}
    </div>
  );
}

function PlayerRow({
  p,
  team,
  partner,
  move,
  onMove,
}: {
  p: RosterPlayer;
  team: string;
  partner: string | null;
  move: Move | undefined;
  onMove: (next: Move | { kind: "none"; id: number }) => void;
}) {
  const traded = move && move.kind === "t" && move.to !== team;
  const value =
    !move || move.kind !== "i" ? (traded ? `t-${move.to}` : "") : `i-${move.weeks ?? 0}`;
  return (
    <li className="grid min-h-[48px] grid-cols-[1fr_auto_auto] items-center gap-3 py-1">
      <span
        className={`min-w-0 truncate text-[14px] ${move ? "text-ink-soft line-through decoration-ice-scratch" : ""}`}
      >
        {p.name}
      </span>
      <span className="text-right text-[13px] tabular-nums text-ink-soft">
        {goals(p.worth_goals)}
      </span>
      {traded ? (
        <span className="flex items-center gap-2 text-[12px] font-semibold">
          <span className="whitespace-nowrap text-blue-line">To {move.to}</span>
          <button
            type="button"
            aria-label={`Undo move for ${p.name}`}
            onClick={() => onMove({ kind: "none", id: p.id })}
            className="min-h-[44px] px-1 text-[13px] text-blue-line"
          >
            Undo
          </button>
        </span>
      ) : (
        <select
          aria-label={`Move ${p.name}`}
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) onMove({ kind: "none", id: p.id });
            else if (v.startsWith("t-")) onMove({ kind: "t", id: p.id, to: v.slice(2) });
            else onMove({ kind: "i", id: p.id, weeks: Number(v.slice(2)) || null });
          }}
          className={`min-h-[44px] w-[9.5rem] rounded-[var(--radius)] border bg-surface px-2 text-[13px] ${move ? "border-ink font-semibold" : "border-ice-scratch"}`}
        >
          <option value="">Keep</option>
          {partner && <option value={`t-${partner}`}>Trade to {partner}</option>}
          {WEEKS.map((w) => (
            <option key={w} value={`i-${w}`}>
              {outLabel(w)}
            </option>
          ))}
          <option value="i-0">{outLabel(null)}</option>
        </select>
      )}
    </li>
  );
}

function FreeAgentSearch({
  team,
  moves,
  onMove,
  onAgent,
}: {
  team: string;
  moves: Move[];
  onMove: (next: Move) => void;
  onAgent: (a: FreeAgent) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const found = useQuery({
    queryKey: ["free-agents", q.trim().toLowerCase()],
    queryFn: () => api<FreeAgent[]>(`/roster-lab/free-agents?q=${encodeURIComponent(q.trim())}`),
    enabled: open,
    staleTime: 300_000,
    placeholderData: keepPreviousData,
  });
  const taken = new Set(moves.map((m) => m.id));
  const list = (found.data ?? []).filter((a) => !taken.has(a.id)).slice(0, 6);
  return (
    <div className="mt-6 border-t-2 border-ink pt-3">
      <label className="flex flex-col gap-1 text-[13px] text-ink-soft">
        <span className="text-[15px] font-semibold text-ink">Sign a free agent</span>
        <input
          type="search"
          aria-label={`Find a free agent for ${team}`}
          placeholder="Name"
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setOpen(true);
            setQ(e.target.value);
          }}
          className="min-h-[44px] rounded-[var(--radius)] border border-ice-scratch bg-surface px-3 text-[14px] text-ink"
        />
      </label>
      {open && (
        <ul className="mt-1 divide-y divide-ice-scratch">
          {found.isError && (
            <li className="py-2 text-[13px] text-ink-soft">Free agents could not load.</li>
          )}
          {found.data && list.length === 0 && (
            <li className="py-2 text-[13px] text-ink-soft">No free agent by that name.</li>
          )}
          {list.map((a) => (
            <li key={a.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-1">
              <span className="min-w-0 truncate text-[14px]">
                {a.name}
                <span className="ml-2 text-[12px] text-ink-soft">
                  {a.position}
                  {a.last_team ? `, last with ${a.last_team}` : ""}
                </span>
              </span>
              <span className="text-right text-[13px] tabular-nums text-ink-soft">
                {goals(a.worth_goals)}
              </span>
              <button
                type="button"
                aria-label={`Sign ${a.name} to ${team}`}
                onClick={() => {
                  onAgent(a);
                  onMove({ kind: "s", id: a.id, to: team });
                  setQ("");
                  setOpen(false);
                }}
                className="min-h-[44px] rounded-[var(--radius)] px-3 text-[13px] font-semibold text-blue-line ring-1 ring-ice-scratch ring-inset hover:bg-ice-land"
              >
                Sign
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Change({ before, after, digits = 1 }: { before: number; after: number; digits?: number }) {
  const d = after - before;
  return (
    <span
      className={`text-[12px] tabular-nums ${Math.abs(d) < 0.0005 ? "text-ink-soft" : d > 0 ? "up" : "down"}`}
    >
      {pp(d, digits)}
    </span>
  );
}

function Results({
  result,
  changed,
  updating,
  names,
}: {
  result: RosterRunOut;
  changed: RosterTeamLine[];
  updating: boolean;
  names: Record<string, { name: string } | undefined>;
}) {
  const [all, setAll] = useState(false);
  const rows = [...result.teams].sort((a, b) => b.playoffs_after - a.playoffs_after);
  const shown = all ? rows : rows.filter((t) => result.changed.includes(t.team));
  return (
    // Stays in place (dimmed) while the season reruns, so nothing jumps.
    <div className={`transition-opacity ${updating ? "opacity-50" : ""}`}>
      {changed.map((t) => (
        <div
          key={t.team}
          data-testid={`result-${t.team}`}
          className="border-b border-ice-scratch py-4"
        >
          <Link
            to={`/team/${t.team}`}
            className="display inline-flex items-center gap-2 text-[26px] font-bold"
          >
            <TeamLogo team={t.team} size={28} />
            {names[t.team]?.name ?? t.team}
          </Link>
          <dl className="mt-3 grid grid-cols-3 gap-3">
            {(
              [
                ["Playoffs", t.playoffs_before, t.playoffs_after, "pct"],
                ["Stanley Cup", t.cup_before, t.cup_after, "pct"],
                ["Points", t.points_before, t.points_after, "pts"],
              ] as const
            ).map(([label, before, after, kind]) => (
              <div key={label}>
                <dt className="text-[12px] text-ink-soft">{label}</dt>
                <dd className="mt-1">
                  <span className="text-[13px] tabular-nums text-ink-soft">
                    {kind === "pct" ? pct(before) : before.toFixed(0)}
                    {" to "}
                  </span>
                  <span
                    className={`display block text-[30px] font-bold leading-none tabular-nums ${Math.abs(after - before) < (kind === "pct" ? 0.0005 : 0.05) ? "" : after > before ? "up" : "down"}`}
                  >
                    {kind === "pct" ? pct(after) : after.toFixed(0)}
                  </span>
                  {kind === "pct" ? (
                    <Change before={before} after={after} />
                  ) : (
                    <span className="text-[12px] tabular-nums text-ink-soft">
                      {goals(after - before)} pts
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {(result.why[t.team] ?? []).length > 0 && (
            <ul className="mt-3 text-[13px]">
              {result.why[t.team]!.map((w) => (
                <li key={w.player_id} className="flex justify-between gap-3 py-0.5">
                  <span className="min-w-0 truncate">{w.name}</span>
                  <span
                    className={`tabular-nums ${w.goals > 0.05 ? "up" : w.goals < -0.05 ? "down" : "text-ink-soft"}`}
                  >
                    {goals(w.goals)} goals
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {changed.length === 0 && (
        <p className="mt-3 text-[13px] text-ink-soft">
          These moves change no team's lineup over the rest of the season.
        </p>
      )}
      <p className="mt-4 text-[12px] text-ink-soft">
        Goals are each move's goal difference over the rest of the season. Small differences are
        estimates, not guarantees.
      </p>
      <div className="mt-6 flex items-end justify-between border-b border-ink pb-1">
        <h3 className="text-[15px] font-semibold">League playoff odds</h3>
        <button
          type="button"
          onClick={() => setAll((a) => !a)}
          className="min-h-[44px] text-[13px] font-semibold text-blue-line"
        >
          {all ? "Show changed teams" : "Show all 32 teams"}
        </button>
      </div>
      <table className="w-full text-[14px]">
        <thead className="text-left text-[12px] text-ink-soft">
          <tr>
            <th className="py-1 font-normal">Team</th>
            <th className="text-right font-normal">Before</th>
            <th className="text-right font-normal">After</th>
            <th className="text-right font-normal">Change</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((t) => {
            const hit = result.changed.includes(t.team);
            return (
              <tr
                key={t.team}
                className={`border-t border-ice-scratch ${hit ? "bg-surface font-semibold" : ""}`}
              >
                <td className="py-1.5">
                  <span className="display inline-flex items-center gap-2 text-[18px] font-bold">
                    <TeamLogo team={t.team} size={20} />
                    {t.team}
                  </span>
                </td>
                <td className="text-right tabular-nums text-ink-soft">{pct(t.playoffs_before)}</td>
                <td className="text-right tabular-nums">{pct(t.playoffs_after)}</td>
                <td className="text-right">
                  <Change before={t.playoffs_before} after={t.playoffs_after} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
