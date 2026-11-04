"""Step 2b: the constraint filter. Plain code, no AI, so the hard rules
(open then, price, diet, rating, not visited lately) are guaranteed."""
from __future__ import annotations

from datetime import datetime, timedelta

from store import DateRequest

MIN_RATING = 4.2
WEEK = 7 * 24 * 60


def _minute_of_week(t: datetime) -> int:
    places_day = (t.weekday() + 1) % 7          # Places: 0 = Sunday; Python: 0 = Monday
    return places_day * 1440 + t.hour * 60 + t.minute


def is_open_at(periods: list[dict] | None, when: datetime) -> bool | None:
    """True/False if we know the hours, None if Places gave us none."""
    if not periods:
        return None
    t = _minute_of_week(when)
    for p in periods:
        o, c = p["open"], p.get("close")
        if c is None:                            # open 24 hours
            return True
        start = o["day"] * 1440 + o.get("hour", 0) * 60 + o.get("minute", 0)
        end = c["day"] * 1440 + c.get("hour", 0) * 60 + c.get("minute", 0)
        if end <= start:                         # closes after midnight / wraps the week
            end += WEEK
        if start <= t < end or start <= t + WEEK < end:
            return True
    return False


def check(venue: dict, req: DateRequest, visited: set[str]) -> str | None:
    """Return the reason a venue fails, or None if it passes."""
    if venue["place_id"] in visited:
        return "visited lately"
    if (venue.get("rating") or 0) < MIN_RATING:
        return "rating too low"
    price = venue.get("price_level")
    if price is not None and not (req.price_min <= price <= req.price_max):
        return "outside budget"
    if req.vegetarian and venue.get("serves_vegetarian") is False:
        return "no vegetarian options"
    # must be open on arrival and still open an hour later
    for t in (req.when, req.when + timedelta(minutes=60)):
        if is_open_at(venue.get("hours"), t) is False:
            return "closed then"
    return None


def apply(venues: list[dict], req: DateRequest, visited: set[str]) -> tuple[list[dict], dict[str, int]]:
    """Dedupe, then filter. Returns (kept venues, count of drops by reason)."""
    seen, kept, dropped = set(), [], {}
    for v in venues:
        if v["place_id"] in seen:
            continue
        seen.add(v["place_id"])
        reason = check(v, req, visited)
        if reason:
            dropped[reason] = dropped.get(reason, 0) + 1
        else:
            kept.append(v)
    return kept, dropped
