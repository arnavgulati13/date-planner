"""Load a made-up demo couple with five past dates, so the demo opens with a
real-looking memory. Run directly (python -m scripts.seed_demo) or from the
app's Setup page. Edit the names and tastes below to make it your own."""
from __future__ import annotations

import json
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import store  # noqa: E402

A, B = "Maya", "Sam"

COUPLE = {
    "home_area": "Logan Square",
    "partners": [
        {"name": A, "cuisines": ["Mexican", "Korean", "Japanese", "Cocktail bars"], "never": ["Chain restaurants"],
         "vibe": 6, "dietary": [], "dealbreakers": ""},
        {"name": B, "cuisines": ["Italian", "Mediterranean", "New American", "Wine bars"], "never": ["Loud rooms"],
         "vibe": 3, "dietary": ["vegetarian"], "dealbreakers": "can't hear each other talk"},
    ],
}

SWIPES = {  # venue name -> (A likes?, B likes?)
    "Kumiko": (True, True), "The Violet Hour": (True, True), "Avec": (True, True),
    "Lula Cafe": (True, True), "Big Star": (True, False), "Au Cheval": (True, False),
    "Elske": (True, True), "Green Mill Cocktail Lounge": (True, True), "Mi Tocaya Antojeria": (True, False),
    "Girl & the Goat": (True, True), "Longman & Eagle": (False, False), "Hopleaf": (False, True),
}

PAST_DATES = [  # days ago, venue, A returns?, B returns?, note, kind
    (70, "Avec", True, True, "Shared everything, perfect pace", "best_fit"),
    (56, "Girl & the Goat", True, False, "Great food, hated the 45-min wait", "best_fit"),
    (42, "The Violet Hour", True, True, "Loved the dim room, could actually talk", "best_fit"),
    (28, "Big Star", False, False, "Way too loud, couldn't hear each other", "wildcard"),
    (14, "Lula Cafe", True, True, "Cozy, Sam loved the vegetable dishes", "best_fit"),
]


def _d(days_ago: int) -> str:
    return (datetime.now() - timedelta(days=days_ago)).strftime("%m/%d")


PROFILE = f"""## Shared loves
- Dim, intimate rooms with great cocktails [both ♥ Kumiko, The Violet Hour at onboarding · returned: The Violet Hour {_d(42)}]
- Shareable small plates at an easy pace [returned: Avec {_d(70)}]
- Seasonal, vegetable-forward cooking [returned: Lula Cafe {_d(14)}]

## Where they differ
- {A}: loves spice and bold flavours (Mexican, Korean) · {B}: vegetarian, prefers quieter rooms [onboarding]

## Avoid  (2+ negative signals)
- Loud, high-energy rooms where you can't talk [Big Star {_d(28)}: "way too loud" · {B}'s onboarding: no loud rooms]

## Watch  (1 signal)
- Long waits [Girl & the Goat {_d(56)}: "hated the 45-min wait"]

## To explore
- Korean
- Live jazz
- A tasting menu for a special night

## Recent dates
- {_d(14)} Lula Cafe: both would return
- {_d(28)} Big Star: neither would return
- {_d(42)} The Violet Hour: both would return
- {_d(56)} Girl & the Goat: split ({A} yes, {B} no)
- {_d(70)} Avec: both would return
"""


def seed() -> None:
    store.reset()
    venues = {v["name"]: v for v in json.loads((store.DATA / "sample_venues.json").read_text())}
    store.save_couple(COUPLE)

    onboard_ts = (datetime.now() - timedelta(days=80)).isoformat(timespec="seconds")
    for name, likes in SWIPES.items():
        v = venues[name]
        for who, liked in zip((A, B), likes):
            store.log("seed_swipe", ts=onboard_ts, partner=who, place_id=v["place_id"], name=name,
                      venue_type=v["type"], liked=liked)

    for days, name, ra, rb, note, kind in reversed(PAST_DATES):
        v = venues[name]
        when = (datetime.now() - timedelta(days=days)).replace(hour=19, minute=30, second=0, microsecond=0)
        ts = (when - timedelta(days=3)).isoformat(timespec="seconds")
        sid, bid = uuid.uuid4().hex[:8], uuid.uuid4().hex[:8]
        store.log("shown", ts=ts, session_id=sid, place_ids=[v["place_id"]], kinds=[kind], request="(seeded)")
        store.log("picked", ts=ts, session_id=sid, place_id=v["place_id"], name=name, kind=kind)
        store.log("booked", ts=ts, booking_id=bid, session_id=sid, place_id=v["place_id"], name=name,
                  when=when.isoformat(), kind=kind)
        store.log("feedback", ts=(when + timedelta(days=1)).isoformat(timespec="seconds"), booking_id=bid,
                  place_id=v["place_id"], name=name, when=when.isoformat(), would_return={A: ra, B: rb},
                  note=note, kind=kind)

    store.save_profile(PROFILE)
    store.log("profile_updated", learned=["(seeded demo profile)"])


if __name__ == "__main__":
    seed()
    print(f"Seeded {A} & {B}: {len(store.events())} events, profile at {store.PROFILE}")
