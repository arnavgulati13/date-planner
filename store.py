"""Everything the app remembers, as plain files in data/.

couple.json   partner onboarding answers
profile.md    the memory (rewritten by the LLM after every date)
events.jsonl  append-only log of every swipe, pick, rejection and rating
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

# The couple's files. The test runner points DATE_NIGHT_DATA at a scratch folder so tests never touch real data.
DATA = Path(os.getenv("DATE_NIGHT_DATA") or Path(__file__).parent / "data")
COUPLE = DATA / "couple.json"
PROFILE = DATA / "profile.md"
EVENTS = DATA / "events.jsonl"


@dataclass
class DateRequest:
    when: datetime
    area: str
    price_min: int = 2          # 1 = $, 4 = $$$$
    price_max: int = 3
    vibes: list[str] = field(default_factory=list)
    occasion: str = "casual"    # casual | special
    notes: str = ""             # "anything else?" + refine text
    vegetarian: bool = False

    def describe(self) -> str:
        lines = [
            f"When: {self.when:%A %B %d, %I:%M %p}",
            f"Area: {self.area}",
            f"Budget: {'$' * self.price_min} to {'$' * self.price_max}",
            f"Vibe: {', '.join(self.vibes) or 'no preference'}",
            f"Occasion: {self.occasion}",
        ]
        if self.vegetarian:
            lines.append("Needs good vegetarian options")
        if self.notes:
            lines.append(f"Extra notes: {self.notes}")
        return "\n".join(lines)


# ---------- couple + profile ----------

def load_couple() -> dict | None:
    return json.loads(COUPLE.read_text()) if COUPLE.exists() else None


def save_couple(couple: dict) -> None:
    DATA.mkdir(exist_ok=True)
    COUPLE.write_text(json.dumps(couple, indent=2))


def partner_names() -> tuple[str, str]:
    c = load_couple() or {}
    ps = c.get("partners", [])
    return (ps[0]["name"] if ps else "Partner A", ps[1]["name"] if len(ps) > 1 else "Partner B")


def load_profile() -> str:
    return PROFILE.read_text() if PROFILE.exists() else ""


def save_profile(md: str) -> None:
    DATA.mkdir(exist_ok=True)
    PROFILE.write_text(md.strip() + "\n")


# ---------- event log ----------

def log(type_: str, **fields) -> dict:
    """Append one event. Types: seed_swipe, search, shown, picked, rejected,
    booked, feedback, profile_edit."""
    DATA.mkdir(exist_ok=True)
    event = {"ts": fields.pop("ts", None) or datetime.now().isoformat(timespec="seconds"),
             "type": type_, **fields}
    with EVENTS.open("a") as f:
        f.write(json.dumps(event) + "\n")
    return event


def events() -> list[dict]:
    if not EVENTS.exists():
        return []
    return [json.loads(line) for line in EVENTS.read_text().splitlines() if line.strip()]


def pending_checkin(now: datetime | None = None) -> dict | None:
    """The most recent booked date whose time has passed and has no feedback yet
    (Assignment 3's 'session gate'). Pass a later `now` to fast-forward in demos."""
    now = now or datetime.now()
    evs = events()
    rated = {e["booking_id"] for e in evs if e["type"] in ("feedback", "checkin_skipped")}
    for e in reversed(evs):
        if e["type"] == "booked" and e["booking_id"] not in rated:
            if datetime.fromisoformat(e["when"]) <= now:
                return e
    return None


def recently_visited(days: int = 60) -> set[str]:
    cutoff = datetime.now() - timedelta(days=days)
    return {e["place_id"] for e in events()
            if e["type"] == "booked" and datetime.fromisoformat(e["when"]) >= cutoff}


def stats() -> dict:
    evs = events()
    sessions = [e for e in evs if e["type"] == "shown"]
    picks = [e for e in evs if e["type"] == "picked"]
    feedback = [e for e in evs if e["type"] == "feedback"]
    booked = [e for e in evs if e["type"] == "booked"]
    wildcard_picks = [e for e in picks if e.get("kind") == "wildcard"]
    both_return = [e for e in feedback if all(e["would_return"].values())]

    def pct(a, b):
        return f"{round(100 * a / b)}%" if b else "–"

    return {
        "Pick rate": pct(len({e['session_id'] for e in picks}), len(sessions)),
        "Joint return rate": pct(len(both_return), len(feedback)),
        "Wildcard pick share": pct(len(wildcard_picks), len(picks)),
        "Check-in completion": pct(len(feedback), len(booked)),
    }


def reset() -> None:
    for p in (COUPLE, PROFILE, EVENTS):
        p.unlink(missing_ok=True)
