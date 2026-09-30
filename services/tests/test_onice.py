from aftershock.jobs.onice import on_ice


def shift(pid: int, team: str, period: int, start: str, end: str) -> dict[str, object]:
    return {
        "typeCode": 517,
        "playerId": pid,
        "teamAbbrev": team,
        "period": period,
        "startTime": start,
        "endTime": end,
    }


def test_on_ice_uses_period_window_and_skips_goalies() -> None:
    shifts = [
        shift(1, "MTL", 1, "09:30", "10:20"),  # on
        shift(2, "MTL", 1, "10:00", "10:05"),  # ends exactly at the goal: on
        shift(3, "MTL", 1, "10:05", "10:40"),  # starts at the goal: off
        shift(4, "NSH", 1, "09:00", "11:00"),  # on, other team
        shift(5, "NSH", 1, "00:00", "20:00"),  # goalie
        shift(6, "MTL", 2, "09:30", "10:30"),  # other period
        {"typeCode": 505, "playerId": 7, "teamAbbrev": "MTL", "period": 1},  # goal row
    ]
    ice = on_ice(shifts, period=1, t_period_s=605, goalies={5})
    assert ice == {"MTL": {1, 2}, "NSH": {4}}
