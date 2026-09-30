"""The live engine core: snapshots in, tremors and odds out.

This module has no I/O. ``SeasonEngine.handle`` takes one play-by-play
snapshot and returns ``Effects``: typed records to persist and messages to
publish. The live worker and the history precompute drive it the same way,
one with ``LiveSource`` and the other with ``ReplaySource``.
"""

from __future__ import annotations

import copy
import itertools
import time
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Any

import numpy as np

from aftershock.live.diff import ChangedPlay, DiffResult, GameDiffer, NewPlay
from aftershock.ml.strength import OUTCOMES, Pregame, StrengthParams, six_way
from aftershock.ml.wp import ShootoutState, WinProbModel
from aftershock.ml.wp_features import GameState, GameStateTracker
from aftershock.ml.xg import XgModel
from aftershock.ml.xg_features import xg_rows
from aftershock.nhl.parse import (
    FINISHED_STATES,
    LIVE_STATES,
    REG_GAME_S,
    GameMeta,
    ParsedGame,
    Play,
)
from aftershock.sim.backend import SimBackend, SimOutput
from aftershock.sim.inputs import END_CODES, END_OT_FORFEIT, SimInputs
from aftershock.tremors.compute import MagnitudeScale, TremorCalc, compute_tremor

SO_ATTEMPTS = frozenset({"goal", "shot-on-goal", "missed-shot", "failed-shot-attempt"})


@dataclass
class TremorRecord:
    """Everything needed to persist and publish one tremor."""

    game_id: int
    event_id: int
    season: int
    night_date: Any
    team: str
    opponent: str
    home: str
    away: str
    scorer_id: int | None
    assist1_id: int | None
    assist2_id: int | None
    goalie_id: int | None
    period: int
    period_type: str
    t_period_s: int
    t_game_s: int
    shootout: bool
    score_before: dict[str, int]
    score_after: dict[str, int]
    wp_before: dict[str, float]
    wp_after: dict[str, float]
    calc: TremorCalc
    venue: str | None
    at: datetime
    id: int | None = None
    overturned: bool = False


@dataclass
class OddsSnapshot:
    trigger: str
    trigger_ref: str | None
    output: SimOutput
    inputs: SimInputs
    at: datetime
    persist: bool = True
    before_ref: bool = False


@dataclass
class Effects:
    tremors: list[TremorRecord] = field(default_factory=list)
    reversals: list[tuple[TremorRecord, TremorCalc]] = field(default_factory=list)
    corrections: list[tuple[TremorRecord, dict[str, Any]]] = field(default_factory=list)
    odds: list[OddsSnapshot] = field(default_factory=list)
    game_updates: list[int] = field(default_factory=list)
    finals: list[int] = field(default_factory=list)
    period_ends: list[int] = field(default_factory=list)
    diff: DiffResult | None = None
    wp_points: list[tuple[int, int | None, dict[str, float]]] = field(default_factory=list)
    xg: dict[int, float] = field(default_factory=dict)

    def merge(self, other: Effects) -> None:
        self.tremors += other.tremors
        self.reversals += other.reversals
        self.corrections += other.corrections
        self.odds += other.odds
        self.game_updates += other.game_updates
        self.finals += other.finals
        self.period_ends += other.period_ends
        self.wp_points += other.wp_points
        self.xg.update(other.xg)


@dataclass
class LiveGame:
    game_id: int
    meta: GameMeta
    differ: GameDiffer
    pregame: Pregame
    playoff: bool
    tracker: GameStateTracker
    applied: set[int] = field(default_factory=set)
    shootout: ShootoutState | None = None
    wp: dict[str, float] = field(default_factory=dict)
    tremors: dict[int, TremorRecord] = field(default_factory=dict)
    finished: bool = False


class SeasonEngine:
    def __init__(
        self,
        *,
        inputs: SimInputs,
        backend: SimBackend,
        wp_model: WinProbModel,
        xg_model: XgModel,
        params: StrengthParams,
        n_sims: int,
        magnitude: MagnitudeScale,
        seed: int = 20262027,
        pregame_lambdas: Callable[[int], tuple[float, float] | None] | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.inputs = inputs
        self.backend = backend
        self.wp_model = wp_model
        self.xg_model = xg_model
        self.params = params
        self.n_sims = n_sims
        self.magnitude = magnitude
        self._seeds = itertools.count(seed)
        self.seed = next(self._seeds)
        self.pregame_lambdas = pregame_lambdas
        self.games: dict[int, LiveGame] = {}
        self.current: SimOutput | None = None
        self.clock = clock or (lambda: datetime.now().astimezone())
        self.last_full_run = 0.0

    # ------------------------------------------------------------------
    # Simulation

    def full_run(self, trigger: str, ref: str | None = None) -> OddsSnapshot:
        self.seed = next(self._seeds)
        out = self.backend.run(self.inputs, self.n_sims, self.seed)
        self.current = out
        self.last_full_run = time.monotonic()
        return OddsSnapshot(trigger, ref, out, self.inputs.copy(), self.clock())

    def reweight_live(self) -> tuple[dict[str, np.ndarray], float] | None:
        """Drift: reweight the latest run by the live games' current distributions."""
        if self.current is None:
            return None
        focus = [int(g) for g in self.current.focus]
        pos, probs = [], []
        for lg in self.games.values():
            i = self.inputs.schedule.index.get(lg.game_id)
            if i is None or lg.finished or i not in focus or not lg.wp:
                continue
            pos.append(focus.index(i))
            probs.append([lg.wp[k] for k in OUTCOMES])
        if not pos:
            return None
        res = self.current.reweight(
            np.array(pos, dtype=np.uint32), np.array(probs, dtype=np.float32)
        )
        return {k: np.asarray(res[k]) for k in ("p_playoffs", "p_division", "p_cup")}, float(
            res["ess"]
        )

    # ------------------------------------------------------------------
    # Games

    def _pregame(self, meta: GameMeta) -> Pregame:
        lam = self.pregame_lambdas(meta.id) if self.pregame_lambdas else None
        if lam is None:
            lam = (self.params.league_goals * self.params.home_ice, self.params.league_goals)
        return six_way(lam[0], lam[1], self.params, playoff=meta.game_type == 3)

    def _game(self, parsed_meta: GameMeta) -> LiveGame:
        lg = self.games.get(parsed_meta.id)
        if lg is None:
            lg = LiveGame(
                game_id=parsed_meta.id,
                meta=parsed_meta,
                differ=GameDiffer(parsed_meta.id),
                pregame=self._pregame(parsed_meta),
                playoff=parsed_meta.game_type == 3,
                tracker=GameStateTracker(parsed_meta.home.id),
            )
            self.games[parsed_meta.id] = lg
        return lg

    def _wp(self, lg: LiveGame, state: GameState, *, final: bool = False) -> dict[str, float]:
        if final:
            return self._final_wp(lg)
        return self.wp_model.six_way(
            state, lg.pregame, playoff=lg.playoff, shootout=copy.copy(lg.shootout)
        )

    def _final_wp(self, lg: LiveGame) -> dict[str, float]:
        m = lg.meta
        home_won = (m.home.score or 0) > (m.away.score or 0)
        kind = {"REG": "reg", "OT": "ot", "SO": "so"}.get(m.last_period_type or "REG", "reg")
        side = "home" if home_won else "away"
        return {k: 1.0 if k == f"{side}_{kind}" else 0.0 for k in OUTCOMES}

    def _lam_rem(self, lg: LiveGame, state: GameState) -> tuple[float, float]:
        frac = state.secs_left_reg / REG_GAME_S if state.period <= 3 else 0.0
        return (lg.pregame.lam_home * frac, lg.pregame.lam_away * frac)

    def _with_game(self, lg: LiveGame, wp: dict[str, float], state: GameState) -> SimInputs:
        inp = self.inputs.copy()
        if lg.game_id in inp.schedule.index:
            inp.set_live(
                lg.game_id, wp, state.home_score, state.away_score, self._lam_rem(lg, state)
            )
        return inp

    def _team_abbrevs(self, lg: LiveGame, owner: int | None) -> tuple[str, str]:
        m = lg.meta
        if owner == m.home.id:
            return m.home.abbrev, m.away.abbrev
        return m.away.abbrev, m.home.abbrev

    def _xg_maps(self, game: ParsedGame) -> tuple[dict[int, float], dict[int, int]]:
        rows = xg_rows(game, include_penalty_shots=True)
        vals = self.xg_model.predict_rows(rows)
        xg = {int(r["event_id"]): float(v) for r, v in zip(rows, vals, strict=True)}
        return xg, {int(r["event_id"]): int(r["team_id"]) for r in rows}

    def handle(self, raw: dict[str, Any], game: ParsedGame) -> Effects:
        """Process one snapshot of one game."""
        eff = Effects()
        lg = self._game(game.meta)
        diff = lg.differ.apply(raw)
        eff.diff = diff
        lg.meta = diff.meta
        if diff.state_changed:
            eff.game_updates.append(lg.game_id)
        xg, shooter = self._xg_maps(game)
        eff.xg = xg
        lg.tracker.set_xg(xg, shooter)

        removed_ids = {p.event_id for p in diff.removed_goals}
        for play in diff.removed_goals:
            rec = lg.tremors.get(play.event_id)
            if rec is not None and not rec.overturned:
                eff.reversals.append(self._reverse(lg, rec))

        for c in diff.changes:
            if isinstance(c, ChangedPlay) and c.play.type == "goal" and c.is_attribution_change:
                rec = lg.tremors.get(c.play.event_id)
                if rec is not None:
                    changes = self._attribution(rec, c.play)
                    if changes:
                        eff.corrections.append((rec, changes))

        if removed_ids:
            self._rebuild_tracker(lg, game)
        new_plays = [c.play for c in diff.changes if isinstance(c, NewPlay)]
        for play in sorted(new_plays, key=lambda p: (p.sort_order, p.event_id)):
            if play.event_id in lg.applied:
                continue
            eff.merge(self._apply_play(lg, play, diff.meta))

        if new_plays or diff.state_changed:
            state = lg.tracker.state
            finished = diff.meta.state in FINISHED_STATES
            lg.wp = self._wp(lg, state, final=finished)
            eff.wp_points.append(
                (int(state.t_game_s), new_plays[-1].event_id if new_plays else None, dict(lg.wp))
            )
            if diff.meta.state in LIVE_STATES and lg.game_id in self.inputs.schedule.index:
                self.inputs.set_live(
                    lg.game_id, lg.wp, state.home_score, state.away_score, self._lam_rem(lg, state)
                )

        if diff.meta.state in FINISHED_STATES and not lg.finished:
            lg.finished = True
            eff.finals.append(lg.game_id)
            self._record_final(lg, game)
            eff.odds.append(self.full_run("final", str(lg.game_id)))
        return eff

    def _rebuild_tracker(self, lg: LiveGame, game: ParsedGame) -> None:
        """Replay the surviving plays after a removal."""
        tracker = GameStateTracker(lg.meta.home.id, *lg.tracker.xg_maps)
        so = None
        for p in game.plays:
            if p.event_id in lg.applied:
                tracker.apply(p)
                if p.period_type == "SO":
                    so = self._so_update(so, p, lg.meta)
        lg.tracker = tracker
        lg.shootout = so
        lg.applied = {p.event_id for p in game.plays if p.event_id in lg.applied}

    def _so_update(self, so: ShootoutState | None, p: Play, meta: GameMeta) -> ShootoutState | None:
        if p.type not in SO_ATTEMPTS or p.owner_team_id is None:
            return so
        home = p.owner_team_id == meta.home.id
        if so is None:
            so = ShootoutState(home_shoots_first=home)
        if home:
            so.home_attempts += 1
            so.home_goals += int(p.type == "goal")
        else:
            so.away_attempts += 1
            so.away_goals += int(p.type == "goal")
        return so

    def _apply_play(self, lg: LiveGame, play: Play, meta: GameMeta) -> Effects:
        eff = Effects()
        lg.applied.add(play.event_id)
        if play.period_type == "SO":
            before_so = copy.copy(lg.shootout)
            lg.tracker.apply(play)
            lg.shootout = self._so_update(lg.shootout, play, meta)
            if play.type == "goal" and lg.shootout is not None:
                wp_after = self._wp(lg, lg.tracker.state)
                p_home = wp_after["home_so"]
                if p_home in (0.0, 1.0):  # this goal decided the shootout
                    pre_state = copy.copy(lg.tracker.state)
                    saved = lg.shootout
                    lg.shootout = before_so or ShootoutState(
                        home_shoots_first=play.owner_team_id == meta.home.id
                    )
                    wp_before = self._wp(lg, pre_state)
                    lg.shootout = saved
                    eff.tremors.append(
                        self._tremor(
                            lg, play, meta, pre_state, pre_state, wp_before, wp_after, shootout=True
                        )
                    )
            return eff
        if play.type != "goal":
            lg.tracker.apply(play)
            if play.type == "period-end" and play.period_type != "SO":
                eff.period_ends.append(lg.game_id)
            return eff
        # A goal: isolate its effect at this moment of the game.
        pre = replace(
            copy.copy(lg.tracker.advance(float(play.t_game_s))),
            situation=play.situation or lg.tracker.state.situation,
        )
        wp_before = self._wp(lg, pre)
        lg.tracker.apply(play)
        post = copy.copy(lg.tracker.state)
        wp_after = self._wp(lg, post)
        eff.tremors.append(self._tremor(lg, play, meta, pre, post, wp_before, wp_after))
        return eff

    def _tremor(
        self,
        lg: LiveGame,
        play: Play,
        meta: GameMeta,
        pre: GameState,
        post: GameState,
        wp_before: dict[str, float],
        wp_after: dict[str, float],
        *,
        shootout: bool = False,
    ) -> TremorRecord:
        before_inputs = self._with_game(lg, wp_before, pre)
        after_inputs = self._with_game(lg, wp_after, post)
        team, opp = self._team_abbrevs(lg, play.owner_team_id)
        seed = next(self._seeds)
        calc = compute_tremor(
            self.backend,
            before_inputs,
            after_inputs,
            n_sims=self.n_sims,
            seed=seed,
            scoring_team=team,
            playoffs=lg.playoff,
            scale=self.magnitude,
        )
        # The after run is the new current snapshot.
        self.inputs = after_inputs
        self.current = calc.after
        self.seed = seed
        rec = TremorRecord(
            game_id=lg.game_id,
            event_id=play.event_id,
            season=meta.season,
            night_date=meta.game_date,
            team=team,
            opponent=opp,
            home=meta.home.abbrev,
            away=meta.away.abbrev,
            scorer_id=play.scorer_id,
            assist1_id=play.assist1_id,
            assist2_id=play.assist2_id,
            goalie_id=play.goalie_id,
            period=play.period,
            period_type=play.period_type,
            t_period_s=play.t_period_s,
            t_game_s=play.t_game_s,
            shootout=shootout,
            score_before={"home": pre.home_score, "away": pre.away_score},
            score_after={"home": post.home_score, "away": post.away_score},
            wp_before=wp_before,
            wp_after=wp_after,
            calc=calc,
            venue=meta.venue,
            at=self.clock(),
        )
        lg.tremors[play.event_id] = rec
        return rec

    def _reverse(self, lg: LiveGame, rec: TremorRecord) -> tuple[TremorRecord, TremorCalc]:
        """Undo a goal: odds move from the with-goal state back to without it."""
        state_with = copy.copy(lg.tracker.state)
        state_without = replace(
            copy.copy(state_with),
            home_score=state_with.home_score - (rec.team == rec.home),
            away_score=state_with.away_score - (rec.team == rec.away),
        )
        wp_with = self._wp(lg, state_with)
        wp_without = self._wp(lg, state_without)
        seed = next(self._seeds)
        calc = compute_tremor(
            self.backend,
            self._with_game(lg, wp_with, state_with),
            self._with_game(lg, wp_without, state_without),
            n_sims=self.n_sims,
            seed=seed,
            scoring_team=rec.team,
            playoffs=lg.playoff,
            scale=self.magnitude,
        )
        self.inputs = self._with_game(lg, wp_without, state_without)
        self.current = calc.after
        rec.overturned = True
        return rec, calc

    def _attribution(self, rec: TremorRecord, play: Play) -> dict[str, Any]:
        changes: dict[str, Any] = {}
        for attr in ("scorer_id", "assist1_id", "assist2_id", "goalie_id"):
            new = getattr(play, attr)
            if getattr(rec, attr) != new:
                setattr(rec, attr, new)
                changes[attr] = new
        return changes

    def _record_final(self, lg: LiveGame, game: ParsedGame) -> None:
        m = lg.meta
        if m.id not in self.inputs.schedule.index or m.home.score is None:
            return
        end = END_CODES.get(m.last_period_type or "REG", 0)
        if m.last_period_type == "OT" and any(
            p.type == "goal" and p.period_type == "OT" and p.goalie_id is None for p in game.plays
        ):
            end = END_OT_FORFEIT
        self.inputs.set_final(m.id, m.home.score, m.away.score or 0, end)
