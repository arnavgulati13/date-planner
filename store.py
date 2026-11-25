"""Everything the app remembers, as plain files, one folder per couple:

DATA/couples/<username>/
    account.json  username, names, hashed password (see accounts.py)
    couple.json   partner onboarding answers
    profile.md    the memory (rewritten by the LLM after every date)
    events.jsonl  append-only log of every swipe, pick, rejection and rating

The server picks the couple for each request from the login session (use_couple).
"""
from __future__ import annotations

import contextvars
import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

# The couple's files. The test runner points DATE_NIGHT_DATA at a scratch folder so tests never touch real data.
DATA = Path(os.getenv("DATE_NIGHT_DATA") or Path(__file__).parent / "data")
COUPLES = DATA / "couples"
NOBODY = DATA / "_no_couple"      # used when nobody is logged in; guarded endpoints never write here

_current: contextvars.ContextVar[Path] = contextvars.ContextVar("couple_dir", default=NOBODY)


def use_couple(username: str | None) -> None:
    """Point this request (or script) at one couple's folder."""
    _current.set(COUPLES / username if username else NOBODY)


def couple_dir() -> Path:
    return _current.get()


def current_username() -> str | None:
    d = couple_dir()
    return d.name if d.parent == COUPLES else None


def _path(name: str) -> Path:
    return couple_dir() / name


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
    craving: str = ""           # optional cuisine or dish for tonight, e.g. "Italian"

    def describe(self) -> str:
        lines = [
            f"When: {self.when:%A %B %d, %I:%M %p}",
            f"Area: {self.area}",
            f"Budget: {'$' * self.price_min} to {'$' * self.price_max}",
            f"Vibe: {', '.join(self.vibes) or 'no preference'}",
            f"Occasion: {self.occasion}",
        ]
        if self.craving:
            lines.append(f"Craving tonight: {self.craving}")
        if self.vegetarian:
            lines.append("Needs good vegetarian options")
        if self.notes:
            lines.append(f"Extra notes: {self.notes}")
        return "\n".join(lines)


# ---------- couple + profile ----------

def load_couple() -> dict | None:
    p = _path("couple.json")
    return json.loads(p.read_text()) if p.exists() else None


def save_couple(couple: dict) -> None:
    couple_dir().mkdir(parents=True, exist_ok=True)
    _path("couple.json").write_text(json.dumps(couple, indent=2))


def partner_names() -> tuple[str, str]:
    c = load_couple() or {}
    ps = c.get("partners", [])
    return (ps[0]["name"] if ps else "Partner A", ps[1]["name"] if len(ps) > 1 else "Partner B")


def load_profile() -> str:
    p = _path("profile.md")
    return p.read_text() if p.exists() else ""


def save_profile(md: str) -> None:
    couple_dir().mkdir(parents=True, exist_ok=True)
    _path("profile.md").write_text(md.strip() + "\n")


# ---------- event log ----------

def log(type_: str, **fields) -> dict:
    """Append one event. Types: seed_swipe, search, shown, picked, rejected,
    booked, feedback, profile_edit."""
    couple_dir().mkdir(parents=True, exist_ok=True)
    event = {"ts": fields.pop("ts", None) or datetime.now().isoformat(timespec="seconds"),
             "type": type_, **fields}
    with _path("events.jsonl").open("a") as f:
        f.write(json.dumps(event) + "\n")
    return event


def events() -> list[dict]:
    p = _path("events.jsonl")
    if not p.exists():
        return []
    return [json.loads(line) for line in p.read_text().splitlines() if line.strip()]


def pending_checkin(now: datetime | None = None) -> dict | None:
    """The most recent booked date whose time has passed and has no feedback yet
    (Assignment 3's 'session gate'). Pass a later `now` to fast-forward in demos."""
    now = now or datetime.now()
    evs = events()
    # "checkin_skipped" only appears in older logs, from when a review could be skipped
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
    """Clear this couple's answers, profile and history. The account itself stays."""
    for name in ("couple.json", "profile.md", "events.jsonl"):
        _path(name).unlink(missing_ok=True)
