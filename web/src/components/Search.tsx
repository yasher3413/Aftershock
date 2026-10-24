import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api/client";
import type { LeadersResponse } from "../api/types.gen";
import { SEASONS } from "../lib/season";
import { TEAMS } from "../lib/teams";
import { TeamLogo } from "./TeamLogo";

type Hit = { kind: "team" | "player"; to: string; label: string; team: string; detail: string };

// There is no player index endpoint; together these boards name nearly
// everyone who has played this season (goals, assists, goalies, and every
// skater with ice time on a goal).
const BOARDS: LeadersResponse["kind"][] = ["skater", "assist", "goalie", "plus_minus"];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const WORDS = /[\s.'-]+/;

// What fans actually type for each team, beyond its name and code.
const NICKNAMES: Record<string, string> = {
  ANA: "ducks",
  BOS: "bs bruins",
  BUF: "sabres",
  CAR: "canes",
  CBJ: "jackets cbj",
  CGY: "flames",
  CHI: "hawks",
  COL: "avs",
  DAL: "stars",
  DET: "wings",
  EDM: "oilers",
  FLA: "cats panthers",
  LAK: "kings",
  MIN: "wild",
  MTL: "habs",
  NJD: "devils",
  NSH: "preds",
  NYI: "isles",
  NYR: "blueshirts",
  OTT: "sens",
  PHI: "flyers",
  PIT: "pens",
  SEA: "kraken",
  SJS: "sharks",
  STL: "blues",
  TBL: "bolts",
  TOR: "leafs buds",
  UTA: "mammoth",
  VAN: "nucks",
  VGK: "knights",
  WPG: "jets",
  WSH: "caps",
};

/** Every word of the query starts some word of the text. Lower is a better match. */
function score(query: string[], text: string, exact?: string): number | null {
  const words = fold(text).split(WORDS);
  if (exact && query.length === 1 && query[0] === fold(exact)) return 0;
  if (!query.every((q) => words.some((w) => w.startsWith(q)))) return null;
  return fold(text).startsWith(query.join(" ")) ? 1 : 2;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden fill="none">
      <circle cx="8.5" cy="8.5" r="5.75" stroke="currentColor" strokeWidth="1.8" />
      <path d="m13 13 4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function Results({ query, onPick }: { query: string; onPick: (to: string) => void }) {
  const season = SEASONS[0];
  const { players, loading } = useQueries({
    queries: BOARDS.map((kind) => ({
      queryKey: ["leaders", season, kind, 500],
      queryFn: () => api<LeadersResponse>(`/leaders/ppa?season=${season}&kind=${kind}&limit=500`),
      staleTime: 600_000,
    })),
    combine: (boards) => {
      const seen = new Map<number, Hit>();
      for (const b of boards)
        for (const r of b.data?.rows ?? []) {
          if (!r.player || seen.has(r.player.id)) continue;
          seen.set(r.player.id, {
            kind: "player",
            to: `/player/${r.player.id}`,
            label: r.player.name,
            team: r.team,
            detail: b.data?.kind === "goalie" ? `Goalie, ${r.team}` : r.team,
          });
        }
      return { players: [...seen.values()], loading: boards.some((b) => b.isPending) };
    },
  });

  // Split the query the way names are split, so "st. louis" matches "St. Louis".
  const q = fold(query.trim()).split(WORDS).filter(Boolean);
  const teams = TEAMS.flatMap((t) => {
    const s = q.length
      ? score(q, `${t.name} ${t.abbrev} ${NICKNAMES[t.abbrev] ?? ""}`, t.abbrev)
      : null;
    const hit: Hit = {
      kind: "team",
      to: `/team/${t.abbrev}`,
      label: t.name,
      team: t.abbrev,
      detail: `${t.division} Division`,
    };
    return s == null ? [] : [{ s, hit }];
  });
  const people = players.flatMap((p) => {
    const s = q.length ? score(q, p.label) : null;
    return s == null ? [] : [{ s, hit: p }];
  });
  const hits = [...teams.sort((a, b) => a.s - b.s), ...people.sort((a, b) => a.s - b.s)]
    .slice(0, 10)
    .map((x) => x.hit);

  // The highlight resets to the top result whenever the query changes.
  const [sel, setSel] = useState({ query, i: 0 });
  const active = sel.query === query ? Math.min(sel.i, Math.max(0, hits.length - 1)) : 0;
  const setActive = (f: (i: number) => number) => setSel({ query, i: f(active) });
  const list = useId();
  // Arrow keys move through the results; Enter opens the highlighted one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hits.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        onPick(hits[active]!.to);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hits, active, onPick]);

  if (!q.length)
    return (
      <p className="px-4 py-5 text-[14px] text-ink-soft">
        Search all 32 teams and every player who has been on the ice for a goal this season.
      </p>
    );
  if (!hits.length)
    return (
      <p className="px-4 py-5 text-[14px] text-ink-soft" role="status">
        {loading ? "Loading players…" : `No team or player matches “${query.trim()}”.`}
      </p>
    );
  return (
    <ul id={list} role="listbox" aria-label="Results" className="max-h-[60vh] overflow-y-auto py-1">
      {hits.map((h, i) => (
        <li key={h.to} role="option" aria-selected={i === active}>
          <button
            type="button"
            onClick={() => onPick(h.to)}
            onMouseMove={() => setActive(() => i)}
            className={`flex min-h-[48px] w-full items-center gap-3 px-4 py-2 text-left ${i === active ? "bg-ice-land" : ""}`}
          >
            <TeamLogo team={h.team} size={h.kind === "team" ? 28 : 22} />
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{h.label}</span>
            <span className="text-[13px] text-ink-soft">{h.detail}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Header search for teams and players. Opens with the button, "/" or Cmd/Ctrl+K. */
export function Search() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  const show = () => {
    setQuery("");
    setOpen(true);
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest(
        "input, textarea, select, [contenteditable]",
      );
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        show();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-label="Search teams and players"
        className="ml-auto inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-[var(--radius)] text-ink-soft hover:text-ink lg:order-last lg:ml-0 lg:justify-start lg:border lg:border-ice-scratch lg:bg-surface lg:px-3 lg:text-[14px]"
      >
        <SearchIcon />
        <span className="hidden lg:inline">Search</span>
        <kbd className="hidden rounded border border-ice-scratch px-1.5 font-[family-name:var(--font-text)] text-[11px] lg:inline">
          /
        </kbd>
      </button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === dialog.current && close()}
        aria-label="Search"
        className="mx-auto mt-[12vh] w-[min(36rem,calc(100%-2rem))] rounded-[var(--radius)] border border-ice-scratch bg-surface p-0 text-ink shadow-[0_12px_48px_rgba(10,20,30,0.25)] backdrop:bg-black/40"
      >
        <div className="flex items-center gap-3 border-b-2 border-ice-scratch px-4 focus-within:border-blue-line">
          <span className="text-ink-soft">
            <SearchIcon />
          </span>
          <input
            autoFocus
            type="text"
            enterKeyHint="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Team or player"
            aria-label="Team or player"
            className="min-h-[56px] flex-1 bg-transparent text-[17px] outline-none placeholder:text-ink-soft"
            // The global :focus-visible ring is unlayered and beats utilities; the
            // row's underline shows focus instead.
            style={{ outline: "none" }}
          />
          <button
            type="button"
            onClick={close}
            className="min-h-[44px] px-1 text-[13px] text-ink-soft hover:text-ink"
          >
            Close
          </button>
        </div>
        {open && (
          <Results
            query={query}
            onPick={(to) => {
              close();
              navigate(to);
            }}
          />
        )}
      </dialog>
    </>
  );
}
