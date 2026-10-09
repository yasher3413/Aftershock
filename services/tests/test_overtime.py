from __future__ import annotations

import math
import random

import pytest

from aftershock.ml.overtime import (
    feed_shootout_home_win_prob,
    overtime_probs,
    rate_from_so_share,
    shootout_home_win_prob,
)


def test_overtime_probabilities_sum_to_one() -> None:
    for secs in (300, 120, 1, 0):
        h, a, so = overtime_probs(secs, 0.55, 0.004)
        assert h + a + so == pytest.approx(1.0)
    assert overtime_probs(0, 0.55, 0.004) == (0.0, 0.0, 1.0)


def test_rate_matches_shootout_share() -> None:
    rate = rate_from_so_share(0.37)
    _, _, so = overtime_probs(300, 0.5, rate)
    assert so == pytest.approx(0.37)


def test_playoff_overtime_ignores_clock() -> None:
    assert overtime_probs(5, 0.6, 0.004, playoff=True) == (0.6, pytest.approx(0.4), 0.0)


def test_shootout_start_is_even_for_equal_shooters() -> None:
    for first in (True, False):
        assert shootout_home_win_prob(0, 0, 0, 0, home_shoots_first=first, p_home=0.31) == (
            pytest.approx(0.5)
        )


def test_shootout_clinch_before_three_rounds() -> None:
    # Home shoots first and leads 2-0 after two rounds: away cannot catch up.
    assert shootout_home_win_prob(2, 0, 2, 2, home_shoots_first=True, p_home=0.3) == 1.0
    # Away shoots first and leads 2-0 with home down to its last attempt: clinched.
    assert shootout_home_win_prob(0, 2, 2, 3, home_shoots_first=False, p_home=0.3) == 0.0
    # Away leads 1-0 after three attempts; home must score its last one to force sudden death.
    p = shootout_home_win_prob(0, 1, 2, 3, home_shoots_first=False, p_home=0.3)
    assert p == pytest.approx(0.3 * 0.5)
    # Completed three rounds with a lead ends it.
    assert shootout_home_win_prob(3, 1, 3, 3, home_shoots_first=True, p_home=0.3) == 1.0


def test_shootout_rejects_unreachable_state() -> None:
    with pytest.raises(ValueError):
        shootout_home_win_prob(0, 0, 0, 2, home_shoots_first=True, p_home=0.3)


def test_feed_shootout_with_wrong_first_shooter() -> None:
    """TOR at VGK, 2026-10-08: the feed listed Vegas's first goal before
    Toronto's first attempt, so Vegas looked like the first shooter, and later
    Toronto had two more attempts than Vegas. Toronto shot first; Vegas's
    third-round goal won it."""
    attempts = [(True, True), (False, True), (False, False), (True, False), (False, False)]
    hg = ag = ha = aa = 0
    for home, goal in attempts:
        ha, aa = ha + home, aa + (not home)
        hg, ag = hg + (home and goal), ag + (not home and goal)
        p = feed_shootout_home_win_prob(hg, ag, ha, aa, home_shoots_first=True, p_home=0.3)
        assert p is not None and 0.0 < p < 1.0
    # Vegas (home) scores its third attempt: 2-1 after three rounds.
    assert feed_shootout_home_win_prob(2, 1, 3, 3, home_shoots_first=True, p_home=0.3) == 1.0
    # Impossible either way round: no answer rather than an error.
    assert feed_shootout_home_win_prob(0, 0, 0, 3, home_shoots_first=True, p_home=0.3) is None


def test_shootout_dp_matches_simulation() -> None:
    rng = random.Random(3)
    ph, pa = 0.35, 0.28

    def play() -> bool:
        hg = ag = 0
        for rnd in range(1, 50):
            hg += rng.random() < ph
            if rnd <= 3 and (hg > ag + (3 - rnd + 1) or ag > hg + (3 - rnd)):
                return hg > ag
            ag += rng.random() < pa
            if rnd <= 3 and (hg > ag + (3 - rnd) or ag > hg + (3 - rnd)):
                return hg > ag
            if rnd >= 3 and hg != ag:
                return hg > ag
        return hg > ag

    n = 60000
    sim = sum(play() for _ in range(n)) / n
    exact = shootout_home_win_prob(0, 0, 0, 0, home_shoots_first=True, p_home=ph, p_away=pa)
    assert exact == pytest.approx(sim, abs=4 * math.sqrt(0.25 / n))
