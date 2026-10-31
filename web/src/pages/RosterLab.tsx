import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { api, ApiError, useStateQuery } from "../api/client";
import type {
  RosterPlayer,
  RosterRunOut,
  RosterTeamLine,
  RosterTeamResponse,
} from "../api/types.gen";
import { Headshot } from "../components/Headshot";
import { TeamLogo } from "../components/TeamLogo";
import { ShareMenu } from "../components/ShareMenu";
import { pct, pp } from "../lib/format";
import { useDocumentMeta } from "../lib/meta";
import { seasonOf } from "../lib/season";
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
const POSITION: Record<string, string> = { F: "Forward", D: "Defence", G: "Goalie" };
const DEFAULT_WEEKS = 4;

type PlayerInfo = { name: string; position: string; team: string | null; worth: number | null };

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

function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}
const PLUS = "M10 4v12M4 10h12";
const CROSS = "M5 5l10 10M15 5L5 15";
const SWAP = "M4 7h12l-3-3M16 13H4l3 3";

export default function RosterLabPage() {
  useDocumentMeta(
    "Roster Lab",
    "Trade players or take one out for a few weeks, and see how far each team's playoff and Stanley Cup odds move.",
  );
  const state = useStateQuery();
  const teamsInfo = useMemo(
    () => Object.fromEntries((state.data?.teams ?? []).map((t) => [t.abbrev, t])),
    [state.data],
  );
  const [params, setParams] = useSearchParams();
  const moves = useMemo(() => parseMoves(params.get("m")), [params]);
  const encoded = encodeMoves(moves);
  // The trade whose results are on screen. A link that arrives with moves
  // (a shared trade) shows its results; after that, only the button runs one.
  const [submitted, setSubmitted] = useState<string>(() => encoded);
  const resultsTop = useRef<HTMLElement>(null);
  const scrollToResults = useRef(false);

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
  const setMoves = (next: Move[]) =>
    update((p) => {
      const e = encodeMoves(next);
      if (e) p.set("m", e);
      else p.delete("m");
    });

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
        if (saved) setSubmitted(saved);
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
    queryKey: ["roster-run", submitted],
    queryFn: () =>
      api<RosterRunOut>("/roster-lab/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encoded: submitted }),
      }),
    enabled: submitted !== "",
    placeholderData: keepPreviousData,
    staleTime: 300_000,
    retry: false,
  });
  const result = submitted && run.data ? run.data : null;
  const updating = run.isFetching;
  const stale = result !== null && submitted !== encoded;

  useEffect(() => {
    if (!scrollToResults.current || updating) return;
    scrollToResults.current = false;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resultsTop.current?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  }, [updating, submitted]);

  // The teams on screen: the ones chosen, then any a shared trade involves.
  const chosen = (params.get("teams") ?? params.get("team") ?? "")
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter((t) => /^[A-Z]{3}$/.test(t));
  const fromRun = (result?.moves ?? []).flatMap((m) => [m.from_team, m.to_team]);
  // A shared link may name only moves; then its teams come from the result.
  const teams = [
    ...new Set(chosen.length ? chosen : fromRun.filter((t): t is string => !!t)),
  ].slice(0, 2);
  const setTeam = (i: number, abbrev: string) => {
    const next = [...teams];
    const old = next[i];
    next[i] = abbrev;
    // Moves that involve the team being replaced no longer make sense.
    const kept =
      old && old !== abbrev
        ? moves.filter((m) => players[m.id]?.team !== old && !(m.kind === "t" && m.to === old))
        : moves;
    // One address change: two in a row would each start from the old address.
    update((p) => {
      p.delete("team");
      const list = next.filter(Boolean);
      if (list.length) p.set("teams", list.join(","));
      else p.delete("teams");
      const e = encodeMoves(kept);
      if (e) p.set("m", e);
      else p.delete("m");
    });
  };

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
  const players: Record<number, PlayerInfo> = {};
  for (const t of teams)
    for (const p of rosterBy[t]?.players ?? [])
      players[p.id] = { name: p.name, position: p.position, team: t, worth: p.worth_goals };
  for (const m of result?.moves ?? [])
    players[m.player_id] ??= {
      name: m.name,
      position: "F",
      team: m.from_team ?? null,
      worth: null,
    };

  const compact = useMedia("(max-width: 639px)");
  const offseason = [run.error, ...rosters.map((r) => r.error)]
    .map(problem)
    .find((p) => p?.offseason);
  const runProblem = submitted === encoded ? problem(run.error) : null;
  const rosterProblem = rosters.map((r) => problem(r.error)).find((p) => p && !p.offseason);

  const changed = (result?.changed ?? [])
    .map((t) => result!.teams.find((x) => x.team === t))
    .filter((t): t is RosterTeamLine => !!t);
  const words = headline(
    moves.map((m) => ({
      name: players[m.id]?.name ?? "A player",
      move: m.kind === "i" ? "injury" : "trade",
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
  const upToDate = moves.length > 0 && submitted === encoded && !run.isError;
  const submit = () => {
    if (submitted === encoded) void run.refetch();
    setSubmitted(encoded);
    scrollToResults.current = true;
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <h1 className="display text-[38px] font-extrabold leading-none sm:text-[60px]">Roster Lab</h1>
      <p className="mt-2 max-w-[62ch] text-[14px] text-ink-soft">
        Build a trade between two teams, or take a player out for a few weeks, then see how the rest
        of the season changes. Each run plays the season 10,000 times before and after.{" "}
        <Link to="/what-if" className="font-semibold text-blue-line hover:underline">
          Pick game results in the What-If Lab
        </Link>
      </p>
      {sharedMissing && (
        <p role="status" className="mt-2 text-[14px] font-semibold">
          That shared trade could not be found. Make your own below.
        </p>
      )}
      {rosterProblem && (
        <p role="alert" className="mt-3 text-[14px] font-semibold">
          {rosterProblem.text}
        </p>
      )}

      <section
        aria-label="The trade"
        className="mt-6 grid items-start gap-4 lg:grid-cols-[1fr_auto_1fr]"
      >
        {[0, 1].map((i) => {
          const team = teams[i] ?? null;
          const partner = teams[1 - i] ?? null;
          const card = (
            <TradeCard
              key={i}
              slot={i}
              team={team}
              partner={partner}
              allTeams={allTeams}
              onTeam={(t) => setTeam(i, t)}
              data={team ? rosterBy[team] : undefined}
              moves={moves}
              players={players}
              onMove={(next) => setMoves(withMove(moves, next))}
            />
          );
          return i === 0 ? (
            card
          ) : (
            <div key="partner" className="contents">
              <div className="flex items-center justify-center text-ink-soft lg:pt-6">
                <span className="rotate-90 lg:rotate-0">
                  <Icon d={SWAP} size={28} />
                </span>
              </div>
              {card}
            </div>
          );
        })}
      </section>
      <p className="mt-3 max-w-[72ch] text-[12px] text-ink-soft">
        Worth is a player&apos;s goal difference for his team over its remaining games. Players out
        of the lineup lately can&apos;t be moved: the forecast already plays without them.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-y-2 border-ink py-4">
        <div className="min-w-0 flex-1 basis-[18rem]" aria-live="polite">
          <p className="text-[15px] font-semibold">
            {moves.length ? words : "No moves yet. Add a player to start a trade."}
          </p>
          {runProblem && (
            <p role="alert" className="mt-1 text-[14px]">
              <span className="font-semibold down">{runProblem.text}</span>{" "}
              {runProblem.retry && (
                <button
                  type="button"
                  onClick={() => void run.refetch()}
                  className="min-h-[44px] font-semibold text-blue-line underline"
                >
                  Try again
                </button>
              )}
            </p>
          )}
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <button
            type="button"
            disabled={moves.length === 0 || (upToDate && !updating && !!result) || updating}
            onClick={submit}
            className="inline-flex min-h-[48px] flex-1 items-center justify-center rounded-[var(--radius)] bg-ink px-6 text-[15px] font-semibold text-ice hover:bg-blue-line hover:text-surface disabled:cursor-default disabled:opacity-50 sm:flex-none"
          >
            {updating ? "Running the season" : "See trade results"}
          </button>
          <button
            type="button"
            disabled={moves.length === 0}
            onClick={() => setMoves([])}
            className="min-h-[48px] shrink-0 rounded-[var(--radius)] border border-ice-scratch px-4 text-[14px] font-semibold disabled:opacity-50"
          >
            Reset
          </button>
          {result && !stale && (
            <ShareMenu spec={rosterShare(result)} disabled={updating} compact={compact} />
          )}
        </div>
      </div>

      {result && (
        <section ref={resultsTop} aria-label="Odds before and after" className="scroll-mt-24 pt-8">
          <div className="flex flex-wrap items-end justify-between gap-2 border-b-2 border-ink pb-3">
            <h2 className="display text-[34px] font-bold leading-none">Before and after</h2>
            {stale && (
              <p className="text-[13px] font-semibold text-ink-soft">
                The trade changed. See trade results to update these numbers.
              </p>
            )}
          </div>
          <Results result={result} changed={changed} dim={updating || stale} names={teamsInfo} />
        </section>
      )}
    </div>
  );
}

function TradeCard({
  slot,
  team,
  partner,
  allTeams,
  onTeam,
  data,
  moves,
  players,
  onMove,
}: {
  slot: number;
  team: string | null;
  partner: string | null;
  allTeams: { abbrev: string; name: string }[];
  onTeam: (abbrev: string) => void;
  data: RosterTeamResponse | undefined;
  moves: Move[];
  players: Record<number, PlayerInfo>;
  onMove: (next: Move | { kind: "none"; id: number }) => void;
}) {
  const season = seasonOf(new Date().toISOString().slice(0, 10));
  const mine = moves.filter((m) => players[m.id]?.team === team);
  const sends = mine.filter((m): m is Extract<Move, { kind: "t" }> => m.kind === "t");
  const out = mine.filter((m): m is Extract<Move, { kind: "i" }> => m.kind === "i");
  const taken = new Set(moves.map((m) => m.id));
  const free = (data?.players ?? []).filter((p) => p.in_lineup && !taken.has(p.id));
  const label = slot === 0 ? "Team" : "Trade partner";

  return (
    <div
      data-testid={team ? `card-${team}` : undefined}
      className="rounded-[var(--radius)] border border-ice-scratch bg-surface p-4 sm:p-5"
    >
      <label className="flex items-center gap-3">
        <span className="sr-only">{label}</span>
        {team && <TeamLogo team={team} size={36} />}
        <select
          aria-label={label}
          value={team ?? ""}
          onChange={(e) => onTeam(e.target.value)}
          className="display min-h-[48px] min-w-0 flex-1 rounded-[var(--radius)] border border-ice-scratch bg-surface px-3 text-[22px] font-bold text-ink"
        >
          <option value="">{slot === 0 ? "Choose a team" : "Choose a trade partner"}</option>
          {/* Until the team list loads, the chosen team still shows. */}
          {team && !allTeams.some((t) => t.abbrev === team) && <option value={team}>{team}</option>}
          {allTeams
            .filter((t) => t.abbrev !== partner)
            .map((t) => (
              <option key={t.abbrev} value={t.abbrev}>
                {t.name}
              </option>
            ))}
        </select>
      </label>

      {!team && (
        <p className="mt-4 text-[13px] text-ink-soft">
          {slot === 0
            ? "Choose a team to start."
            : "Choose a second team to trade with. Without one you can still take players out."}
        </p>
      )}
      {team && !data && <p className="mt-4 text-[13px] text-ink-soft">Loading the roster</p>}
      {team && data && (
        <>
          <h3 className="mt-5 text-[13px] font-semibold text-ink-soft">
            {partner ? `${team} sends to ${partner}` : `${team} sends`}
          </h3>
          <ul data-testid={`sends-${team}`} className="mt-1 divide-y divide-ice-scratch">
            {sends.map((m) => (
              <MoveRow
                key={m.id}
                id={m.id}
                info={players[m.id]}
                team={team}
                season={season}
                onRemove={() => onMove({ kind: "none", id: m.id })}
              />
            ))}
          </ul>
          {partner ? (
            <Picker
              team={team}
              label={`Add a ${team} player to the trade`}
              text="Add a player"
              players={free}
              action={(p) => `Trade ${p.name} to ${partner}`}
              onPick={(p) => onMove({ kind: "t", id: p.id, to: partner })}
            />
          ) : (
            <p className="mt-2 text-[13px] text-ink-soft">
              Choose a trade partner to send players.
            </p>
          )}

          <h3 className="mt-6 text-[13px] font-semibold text-ink-soft">Out injured</h3>
          <ul className="mt-1 divide-y divide-ice-scratch">
            {out.map((m) => {
              const name = players[m.id]?.name ?? "This player";
              return (
                <MoveRow
                  key={m.id}
                  id={m.id}
                  info={players[m.id]}
                  team={team}
                  season={season}
                  onRemove={() => onMove({ kind: "none", id: m.id })}
                >
                  <select
                    aria-label={`How long ${name} is out`}
                    value={m.weeks ?? 0}
                    onChange={(e) =>
                      onMove({ kind: "i", id: m.id, weeks: Number(e.target.value) || null })
                    }
                    className="min-h-[40px] rounded-[var(--radius)] border border-ice-scratch bg-surface px-2 text-[13px]"
                  >
                    {WEEKS.map((w) => (
                      <option key={w} value={w}>
                        {outLabel(w)}
                      </option>
                    ))}
                    <option value={0}>{outLabel(null)}</option>
                  </select>
                </MoveRow>
              );
            })}
          </ul>
          <Picker
            team={team}
            label={`Take a ${team} player out`}
            text="Take a player out"
            players={free}
            action={(p) => `Take ${p.name} out`}
            onPick={(p) => onMove({ kind: "i", id: p.id, weeks: DEFAULT_WEEKS })}
          />
        </>
      )}
    </div>
  );
}

function MoveRow({
  id,
  info,
  team,
  season,
  onRemove,
  children,
}: {
  id: number;
  info: PlayerInfo | undefined;
  team: string;
  season: number;
  onRemove: () => void;
  children?: React.ReactNode;
}) {
  const name = info?.name ?? "A player";
  return (
    <li className="flex min-h-[56px] items-center gap-3 py-2">
      <Headshot playerId={id} name={name} team={team} season={season} size={36} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{name}</span>
        <span className="text-[12px] text-ink-soft">
          {POSITION[info?.position ?? ""] ?? ""}
          {info?.worth != null && (
            <span className="tabular-nums">, worth {goals(info.worth)} goals</span>
          )}
        </span>
      </span>
      {children}
      <button
        type="button"
        aria-label={`Remove ${name} from the trade`}
        onClick={onRemove}
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius)] text-ink-soft hover:bg-ice-land hover:text-ink"
      >
        <Icon d={CROSS} />
      </button>
    </li>
  );
}

/** A button that opens a searchable list of a team's players, in place. */
function Picker({
  team,
  label,
  text,
  players,
  action,
  onPick,
}: {
  team: string;
  label: string;
  text: string;
  players: RosterPlayer[];
  action: (p: RosterPlayer) => string;
  onPick: (p: RosterPlayer) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const close = () => {
    setOpen(false);
    setQ("");
  };
  const needle = q.trim().toLowerCase();
  const shown = players.filter((p) => !needle || p.name.toLowerCase().includes(needle));
  if (!open)
    return (
      <button
        type="button"
        aria-label={label}
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex min-h-[44px] w-full items-center gap-2 rounded-[var(--radius)] border border-dashed border-ice-scratch px-3 text-[14px] font-semibold text-blue-line hover:border-blue-line"
      >
        <Icon d={PLUS} />
        {text}
      </button>
    );
  return (
    <div
      className="mt-2 rounded-[var(--radius)] border border-ink"
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <div className="flex items-center gap-2 border-b border-ice-scratch p-2">
        <input
          type="search"
          autoFocus
          aria-label={`Find a ${team} player`}
          placeholder="Search by name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-h-[40px] min-w-0 flex-1 rounded-[var(--radius)] bg-transparent px-2 text-[14px] text-ink"
        />
        <button
          type="button"
          onClick={close}
          className="min-h-[40px] px-2 text-[13px] font-semibold text-ink-soft hover:text-ink"
        >
          Done
        </button>
      </div>
      <div className="max-h-[22rem] overflow-y-auto overscroll-contain px-2 pb-2">
        {GROUPS.map((g) => {
          const list = shown.filter((p) => p.position === g.pos);
          if (!list.length) return null;
          return (
            <div key={g.pos}>
              <p className="sticky top-0 bg-surface pt-2 pb-1 text-[12px] font-semibold text-ink-soft">
                {g.label}
              </p>
              <ul>
                {list.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      aria-label={action(p)}
                      onClick={() => {
                        onPick(p);
                        close();
                      }}
                      className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-[var(--radius)] px-2 text-left text-[14px] hover:bg-ice-land"
                    >
                      <span className="min-w-0 truncate">{p.name}</span>
                      <span className="shrink-0 text-[13px] tabular-nums text-ink-soft">
                        {goals(p.worth_goals)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {shown.length === 0 && (
          <p className="py-3 text-[13px] text-ink-soft">No {team} player by that name.</p>
        )}
      </div>
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
  dim,
  names,
}: {
  result: RosterRunOut;
  changed: RosterTeamLine[];
  dim: boolean;
  names: Record<string, { name: string } | undefined>;
}) {
  const [all, setAll] = useState(false);
  const rows = [...result.teams].sort((a, b) => b.playoffs_after - a.playoffs_after);
  const shown = all ? rows : rows.filter((t) => result.changed.includes(t.team));
  return (
    // Stays in place (dimmed) while the season reruns, so nothing jumps.
    <div className={`transition-opacity ${dim ? "opacity-50" : ""}`}>
      <div className="grid gap-x-8 lg:grid-cols-2">
        {changed.map((t) => (
          <div
            key={t.team}
            data-testid={`result-${t.team}`}
            className="border-b border-ice-scratch py-5"
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
            {(result.bumped?.[t.team] ?? []).length > 0 && (
              <p className="mt-2 text-[13px] text-ink-soft">
                Out of the lineup to make room:{" "}
                {result.bumped![t.team]!.map((b) => b.name).join(", ")}
              </p>
            )}
          </div>
        ))}
      </div>
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
