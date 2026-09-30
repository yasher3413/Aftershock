"""Empirical checks of the play-by-play feed over the raw cache.

Usage: uv run python ../scripts/analyze_pbp.py [season ...]
Prints the statistics recorded in docs/DATA.md.
"""

from __future__ import annotations

import gzip
import json
import statistics
import sys
from collections import Counter
from pathlib import Path

from aftershock.config import get_settings
from aftershock.nhl.parse import SHOT_TYPES, home_attack_signs, parse_play_by_play


def main() -> None:
    seasons = {int(s) for s in sys.argv[1:]}
    root = get_settings().raw_cache_dir / "play-by-play"
    files = sorted(root.glob("*.json.gz"))
    n_games = 0
    types: Counter[str] = Counter()
    states: Counter[str] = Counter()
    last_period: Counter[str] = Counter()
    shots = shots_null = 0
    goal_x: list[float] = []
    goal_absy: list[float] = []
    agree = disagree = 0
    sit_codes: Counter[str] = Counter()
    en_goals = en_goals_code_ok = 0
    ps_candidates: Counter[str] = Counter()
    so_types: Counter[str] = Counter()
    for path in files:
        gid = int(path.name.split(".")[0])
        season = int(str(gid)[:4])
        season_id = season * 10000 + season + 1
        if seasons and season_id not in seasons:
            continue
        with gzip.open(path, "rt") as fh:
            raw = json.load(fh)
        g = parse_play_by_play(raw)
        n_games += 1
        states[g.meta.state] += 1
        last_period[str(g.meta.last_period_type)] += 1
        explicit = {p.period for p in g.plays if p.home_defending_side}
        if explicit:
            stripped = [p for p in g.plays]
            saved = [p.home_defending_side for p in stripped]
            for p in stripped:
                p.home_defending_side = None
            inferred = home_attack_signs(stripped, g.meta.home.id)
            for p, s in zip(stripped, saved, strict=True):
                p.home_defending_side = s
            truth = home_attack_signs(g.plays, g.meta.home.id)
            for per in explicit:
                if per in inferred and g.plays and any(
                    p.period == per and p.period_type != "SO" for p in g.plays
                ):
                    if inferred[per] == truth[per]:
                        agree += 1
                    else:
                        disagree += 1
        for p in g.plays:
            types[p.type] += 1
            if p.situation_code:
                sit_codes[p.situation_code] += 1
            if p.is_shootout:
                so_types[p.type] += 1
                continue
            if p.type in SHOT_TYPES:
                shots += 1
                if p.x is None or p.y is None:
                    shots_null += 1
            if p.type == "goal" and p.x_norm is not None and p.y_norm is not None:
                goal_x.append(p.x_norm)
                goal_absy.append(abs(p.y_norm))
            if p.type == "goal" and p.goalie_id is None:
                en_goals += 1
                sit = p.situation
                if sit is not None:
                    is_home = p.owner_team_id == g.meta.home.id
                    _, _, _, opp_goalie = sit.for_team(is_home)
                    if not opp_goalie:
                        en_goals_code_ok += 1
            if p.type in SHOT_TYPES and p.situation_code in {"0101", "1010"}:
                ps_candidates[p.situation_code] += 1
    print(f"games: {n_games}")
    print(f"states: {dict(states)}")
    print(f"last period type: {dict(last_period)}")
    print(f"event types: {dict(types.most_common())}")
    print(f"unblocked shots: {shots}, null coords: {shots_null} ({shots_null / max(shots, 1):.4%})")
    print(
        f"goal x_norm: median {statistics.median(goal_x):.1f}, "
        f"share x>25: {sum(x > 25 for x in goal_x) / len(goal_x):.4f}, "
        f"median |y|: {statistics.median(goal_absy):.1f}"
    )
    print(f"direction inference vs homeTeamDefendingSide: agree {agree}, disagree {disagree}")
    print(f"top situation codes: {sit_codes.most_common(12)}")
    print(f"goals with no goalie: {en_goals}, situationCode shows empty net: {en_goals_code_ok}")
    print(f"penalty-shot style codes on shots: {dict(ps_candidates)}")
    print(f"shootout play types: {dict(so_types)}")


if __name__ == "__main__":
    main()
