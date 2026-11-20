"""Neighborhood centers, distances and address cleanup. Plain code, no AI."""
from __future__ import annotations

import math

# Center of each neighborhood the app offers (plus the sample-venue areas). Used to bias Google's
# search toward the area and to drop venues that are too far away.
NEIGHBORHOODS: dict[str, tuple[float, float]] = {
    "Fulton Market": (41.8866, -87.6487),
    "West Loop": (41.8820, -87.6500),
    "Wicker Park": (41.9088, -87.6776),
    "Logan Square": (41.9233, -87.7083),
    "River North": (41.8924, -87.6341),
    "Andersonville": (41.9806, -87.6684),
    "Avondale": (41.9389, -87.7112),
    "Bridgeport": (41.8380, -87.6510),
    "Pilsen": (41.8564, -87.6589),
    "Uptown": (41.9665, -87.6533),
}
MAX_MILES = 1.5          # farther than this from the chosen neighborhood is "too far"


def center(area: str) -> tuple[float, float] | None:
    return NEIGHBORHOODS.get(area.strip())


def miles(a: tuple[float, float], b: tuple[float, float]) -> float:
    (lat1, lng1), (lat2, lng2) = a, b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(h))


def venue_miles(venue: dict, area: str) -> float | None:
    c = center(area)
    if not c or venue.get("lat") is None or venue.get("lng") is None:
        return None
    return miles(c, (venue["lat"], venue["lng"]))


def clean_address(address: str) -> str:
    """Google sometimes puts a building name first: 'FREE METHODIST PUBLISHING HOUSE, 1134 W Washington Blvd'.
    Drop that leading part when it has no number and the next part starts with a street number."""
    parts = [p.strip() for p in (address or "").split(",")]
    if len(parts) > 1 and not any(ch.isdigit() for ch in parts[0]) and parts[1][:1].isdigit():
        parts = parts[1:]
    return ", ".join(parts)
