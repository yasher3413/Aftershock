import pytest

from aftershock.ml.player_value import choose_alpha, finishing, fit_rapm, goalie_gsax
from tests.roster_fixtures import synthetic_stints


def test_rapm_recovers_a_planted_player() -> None:
    vals = fit_rapm(synthetic_stints(seed=3, star=99, boost=0.6), alpha=300)
    assert 0.3 < vals[99][0] < 0.8
    assert abs(vals[99][1]) < 0.2
    assert max(v[0] for k, v in vals.items() if k != 99) < vals[99][0]


def test_rapm_shrinks_a_player_with_few_minutes() -> None:
    vals = fit_rapm(synthetic_stints(seed=3, star=98, boost=0.6, star_games=2), alpha=300)
    assert abs(vals[98][0]) < 0.2


def test_rapm_defense_sign_matches_team_ratings() -> None:
    # A planted defender who cuts the other side's chances gets a negative def.
    stints = synthetic_stints(seed=4, star=97, boost=0.0)
    cut = [
        s.__class__(
            s.game_id,
            s.dur_s,
            s.home,
            s.away,
            s.home_xg * (0.7 if 97 in s.away else 1.0),
            s.away_xg * (0.7 if 97 in s.home else 1.0),
            0,
            0,
        )
        for s in stints
    ]
    assert fit_rapm(cut, alpha=300)[97][1] < -0.3


def test_choose_alpha_picks_from_the_grid() -> None:
    stints = synthetic_stints(seed=5, star=96, boost=0.6, games=120)
    assert choose_alpha(stints, alphas=(30, 300, 3000), folds=3) in (30, 300, 3000)


def test_finishing_and_gsax_shrink_small_samples() -> None:
    assert finishing([(1, 0.1, True)])[1] == pytest.approx(0.9 / 201)
    assert goalie_gsax([(5, 0.1, False)] * 100)[5] == pytest.approx(0.1 * 100 / 1600)
