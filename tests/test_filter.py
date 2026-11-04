import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import filter as f
from store import DateRequest

SAT_8PM = datetime(2026, 11, 7, 20, 0)     # a Saturday
MON_8PM = datetime(2026, 11, 9, 20, 0)     # a Monday
SAT_1AM = datetime(2026, 11, 8, 1, 0)      # Saturday night, after midnight

DINNER = [{"open": {"day": d, "hour": 17, "minute": 0}, "close": {"day": d, "hour": 23, "minute": 0}}
          for d in [0, 2, 3, 4, 5, 6]]     # closed Mondays
BAR = [{"open": {"day": d, "hour": 16, "minute": 0}, "close": {"day": (d + 1) % 7, "hour": 2, "minute": 0}}
       for d in range(7)]                  # Saturday's close wraps into Sunday


def venue(**kw):
    base = {"place_id": "x", "rating": 4.6, "price_level": 2, "serves_vegetarian": True, "hours": DINNER}
    return {**base, **kw}


def req(**kw):
    return DateRequest(**{"when": SAT_8PM, "area": "Logan Square", **kw})


def test_open_hours():
    assert f.is_open_at(DINNER, SAT_8PM) is True
    assert f.is_open_at(DINNER, MON_8PM) is False
    assert f.is_open_at(BAR, SAT_1AM) is True
    assert f.is_open_at(None, SAT_8PM) is None


def test_passes_when_everything_fits():
    assert f.check(venue(), req(), set()) is None


def test_each_rule():
    assert f.check(venue(place_id="seen"), req(), {"seen"}) == "visited lately"
    assert f.check(venue(rating=4.0), req(), set()) == "rating too low"
    assert f.check(venue(price_level=4), req(price_max=3), set()) == "outside budget"
    assert f.check(venue(serves_vegetarian=False), req(vegetarian=True), set()) == "no vegetarian options"
    assert f.check(venue(), req(when=MON_8PM), set()) == "closed then"
    # arriving 10:30pm fails: it closes at 11pm, less than an hour later
    assert f.check(venue(), req(when=datetime(2026, 11, 7, 22, 30)), set()) == "closed then"


def test_unknown_data_is_not_held_against_a_venue():
    assert f.check(venue(price_level=None, serves_vegetarian=None, hours=None), req(vegetarian=True), set()) is None


def test_apply_dedupes_and_counts():
    vs = [venue(place_id="a"), venue(place_id="a"), venue(place_id="b", rating=3.5)]
    kept, dropped = f.apply(vs, req(), set())
    assert [v["place_id"] for v in kept] == ["a"]
    assert dropped == {"rating too low": 1}
