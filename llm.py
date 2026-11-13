"""The three LLM steps: write_queries (step 2), recommend (step 3), update_profile (step 6).

Each call returns structured JSON via a Pydantic schema. If no Anthropic
credentials are set, or a call fails, each step falls back to a simple
keyword heuristic so the app still runs end to end (offline demo mode).
"""
from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Literal

import anthropic
from pydantic import BaseModel, Field

import ailog
import config
import store

PROMPTS = Path(__file__).parent / "prompts"
# Models that accept the server-side refusal fallback. Haiku has none.
FALLBACK_MODELS = {"claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"}

_client: anthropic.Anthropic | None = None


class LLMUnavailable(Exception):
    pass


def model() -> str:
    return config.load()["model"]


def available() -> bool:
    has_key = bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"))
    return has_key and config.load()["use_real_ai"]


def _call(prompt_file: str, user: str, schema: type[BaseModel], step: str) -> BaseModel:
    """The one place the app calls Claude. Every call is written to logs/ai_log.jsonl."""
    global _client
    if not available():
        raise LLMUnavailable("No Anthropic API key set, or use_real_ai is off in config.json")
    _client = _client or anthropic.Anthropic()
    cfg = config.load()
    name, effort = cfg["model"], cfg["effort"][step]
    request = dict(
        model=name,
        max_tokens=16000,
        system=(PROMPTS / prompt_file).read_text(),
        messages=[{"role": "user", "content": user}],
        output_format=schema,
        output_config={"effort": effort},
    )
    started, resp, error = time.monotonic(), None, None
    try:
        if name in FALLBACK_MODELS:
            # if a safety classifier declines, the API retries on a fallback model
            resp = _client.beta.messages.parse(**request, betas=["server-side-fallback-2026-07-01"], fallbacks="default")
        else:
            resp = _client.messages.parse(**request)
        if resp.stop_reason == "refusal" or resp.parsed_output is None:
            error = f"Claude returned no usable answer (stop reason: {resp.stop_reason})"
    except anthropic.APIConnectionError as e:
        error = f"Couldn't reach the Claude API: {e}"
    except anthropic.APIStatusError as e:
        error = f"Claude API error {e.status_code}: {e.message}"
    finally:
        ailog.write(
            "ai_call", step=step, model=name, effort=effort,
            latency_ms=round(1000 * (time.monotonic() - started)),
            input=user,
            output=resp.parsed_output.model_dump() if resp is not None and resp.parsed_output is not None else None,
            usage={"input_tokens": resp.usage.input_tokens, "output_tokens": resp.usage.output_tokens} if resp is not None else None,
            error=error,
        )
    if error:
        raise LLMUnavailable(error)
    return resp.parsed_output


# ---------------------------------------------------------------- shared text

def couple_facts() -> str:
    c = store.load_couple() or {}
    lines = []
    for p in c.get("partners", []):
        lines.append(
            f"- {p['name']}: loves {', '.join(p.get('cuisines', [])) or 'anything'}; "
            f"never {', '.join(p.get('never', [])) or 'nothing listed'}; "
            f"vibe {p.get('vibe', 5)}/10 (0 = cozy, 10 = lively); "
            f"dietary: {', '.join(p.get('dietary', [])) or 'none'}; "
            f"dealbreakers: {p.get('dealbreakers') or 'none'}"
        )
    return "\n".join(lines) or "(no onboarding answers)"


def _date(ts: str) -> str:
    return datetime.fromisoformat(ts).strftime("%m/%d")


def describe_events(evs: list[dict]) -> str:
    out = []
    for e in evs:
        t, d = e["type"], _date(e["ts"])
        if t == "seed_swipe":
            out.append(f"{d} onboarding: {e['partner']} {'♥' if e['liked'] else '✕'} {e['name']} ({e.get('venue_type', '')})")
        elif t == "rejected":
            out.append(f"{d} passed on {e['name']} ({e['reason']})")
        elif t == "picked":
            out.append(f"{d} picked {e['name']} ({e['kind'].replace('_', ' ')})")
        elif t == "feedback":
            verdicts = ", ".join(f"{who} would return: {'yes' if yes else 'no'}" for who, yes in e["would_return"].items())
            note = f' Note: "{e["note"]}"' if e.get("note") else ""
            out.append(f"{_date(e['when'])} date at {e['name']}: {verdicts}.{note}")
    return "\n".join(out) or "(none)"


def _candidates_text(venues: list[dict]) -> str:
    # Short ids (c1, c2...) instead of Google's 27-char place ids, which the model
    # sometimes copies with a typo. recommend() maps them back.
    return json.dumps([{
        "place_id": f"c{i}", "name": v["name"], "where": v.get("address", ""),
        "type": v.get("type", ""), "price": "$" * (v.get("price_level") or 0) or "unknown",
        "rating": v.get("rating"), "summary": v.get("summary", ""),
        "tags": v.get("tags", []), "takes_reservations": v.get("reservable"),
    } for i, v in enumerate(venues, 1)], indent=1)


def _section(profile: str, name: str) -> str:
    m = re.search(rf"## {name}[^\n]*\n(.*?)(?=\n## |\Z)", profile, re.S)
    return m.group(1) if m else ""


def _words(text: str) -> set[str]:
    return set(re.findall(r"[a-z]{4,}", text.lower()))


# ---------------------------------------------------------------- step 2: write searches

class Queries(BaseModel):
    queries: list[str] = Field(description="2-3 Google Maps text searches")
    explore_query: str = Field(description="one search drawn from 'To explore'")


def write_queries(profile: str, req: store.DateRequest) -> tuple[Queries, str | None]:
    user = f"<profile>\n{profile or '(empty)'}\n</profile>\n\n<request>\n{req.describe()}\n</request>"
    try:
        return _call("write_queries.md", user, Queries, step="write_queries"), None
    except LLMUnavailable as e:
        vibe = " ".join(req.vibes[:2]) or "date night"
        explore = re.findall(r"- ([^\[\n,]+)", _section(profile, "To explore"))
        return Queries(
            queries=[f"{vibe} restaurant {req.area}", f"cocktail bar {req.area}"],
            explore_query=f"{explore[0].strip() if explore else 'live music'} {req.area}",
        ), str(e)


# ---------------------------------------------------------------- step 3: recommend

class Pick(BaseModel):
    place_id: str
    kind: Literal["best_fit", "wildcard"]
    headline: str
    why: str
    heads_up: str
    # Stand-in for the return-probability model in Assignment 3: an LLM estimate, not a calibrated probability.
    return_chance: int | None = Field(default=None, description="0-100 estimate that both partners would want to return")


class Recs(BaseModel):
    picks: list[Pick]


def recommend(profile: str, req: store.DateRequest, candidates: list[dict]) -> tuple[list[Pick], str | None]:
    user = (f"<profile>\n{profile or '(empty)'}\n</profile>\n\n<couple>\n{couple_facts()}\n</couple>\n\n"
            f"<request>\n{req.describe()}\n</request>\n\n<candidates>\n{_candidates_text(candidates)}\n</candidates>")
    error = None
    try:
        picks = _call("recommend.md", user, Recs, step="recommend").picks
        ids = {f"c{i}": v["place_id"] for i, v in enumerate(candidates, 1)}
        seen, valid = set(), []
        for p in picks:                      # never trust ids blindly
            real = ids.get(p.place_id.strip())
            if real and real not in seen:
                seen.add(real)
                chance = None if p.return_chance is None else max(0, min(100, p.return_chance))
                valid.append(p.model_copy(update={"place_id": real, "return_chance": chance}))
        if valid:
            return valid[:3], None
        error = "Claude's picks didn't match any candidate"
    except LLMUnavailable as e:
        error = str(e)
    return _heuristic_recommend(profile, req, candidates), error


def _heuristic_recommend(profile: str, req: store.DateRequest, candidates: list[dict]) -> list[Pick]:
    loves = _words(_section(profile, "Shared loves") + " " + " ".join(req.vibes) + " " + req.notes)
    avoid = _words(_section(profile, "Avoid"))
    explore = _words(_section(profile, "To explore"))

    def text(v):
        return " ".join([v["name"], v.get("type", ""), v.get("summary", ""), " ".join(v.get("tags", []))])

    def score(v):
        w = _words(text(v))
        return 2 * len(w & loves) - 3 * len(w & avoid) + (v.get("rating") or 0)

    ranked = sorted(candidates, key=score, reverse=True)
    n_best = 3 if req.occasion == "special" else 2
    best = ranked[:n_best]
    picks = [Pick(place_id=v["place_id"], kind="best_fit", headline=v.get("type") or "Strong match",
                  why=f"Matches what you two keep coming back to: {', '.join(sorted(_words(text(v)) & loves)[:3]) or 'well rated and in budget'}. "
                      "(Offline mode: ranked by keyword overlap with your profile.)",
                  heads_up="") for v in best]
    if n_best == 2:
        rest = [v for v in ranked if v not in best]
        wild = max(rest, key=lambda v: len(_words(text(v)) & explore), default=None)
        if wild:
            picks.append(Pick(place_id=wild["place_id"], kind="wildcard", headline="Something new",
                              why="A stretch from your 'To explore' list. (Offline mode heuristic.)", heads_up=""))
    return picks


# ---------------------------------------------------------------- step 6: update memory

class ProfileUpdate(BaseModel):
    profile_md: str
    learned: list[str]


def update_profile(profile: str, new_events: list[dict], today: datetime | None = None) -> tuple[ProfileUpdate, str | None]:
    """`today` lets the demo fast-forward past a booked date so its check-in isn't treated as from the future."""
    user = (f"<current_profile>\n{profile or '(empty: build the first profile)'}\n</current_profile>\n\n"
            f"<couple>\n{couple_facts()}\n</couple>\n\n"
            f"<new_events>\n{describe_events(new_events)}\n</new_events>\n\n"
            f"Today is {(today or datetime.now()):%m/%d/%Y}.")
    try:
        return _call("update_profile.md", user, ProfileUpdate, step="update_profile"), None
    except LLMUnavailable as e:
        return _heuristic_update(profile, new_events), str(e)


def _heuristic_update(profile: str, new_events: list[dict]) -> ProfileUpdate:
    a, b = store.partner_names()
    if not profile:
        c = store.load_couple() or {"partners": [{}, {}]}
        pa, pb = (c["partners"] + [{}, {}])[:2]
        both = set(pa.get("cuisines", [])) & set(pb.get("cuisines", []))
        hearts = {}
        for e in new_events:
            if e["type"] == "seed_swipe" and e["liked"]:
                hearts.setdefault(e["name"], set()).add(e["partner"])
        loved_by_both = [n for n, who in hearts.items() if len(who) == 2]
        never = set(pa.get("never", [])) | set(pb.get("never", []))
        profile = (
            f"## Shared loves\n- {', '.join(sorted(both)) or 'still learning'} [onboarding]\n"
            f"- Places like {', '.join(loved_by_both[:3]) or '—'} [both ♥ at onboarding]\n\n"
            f"## Where they differ\n- {a}: {', '.join(pa.get('cuisines', []))} · {b}: {', '.join(pb.get('cuisines', []))} [onboarding]\n\n"
            f"## Avoid  (2+ negative signals)\n- {', '.join(sorted(never)) or 'nothing yet'} [onboarding dealbreakers]\n\n"
            f"## Watch  (1 signal)\n- nothing yet\n\n"
            f"## To explore\n- Korean\n- live music\n\n"
            f"## Recent dates\n- none yet\n"
        )
        return ProfileUpdate(profile_md=profile, learned=["+ Built your first profile from onboarding (offline mode)"])
    learned, recent = [], []
    for e in new_events:
        if e["type"] == "feedback":
            verdict = "both would return" if all(e["would_return"].values()) else "split"
            recent.append(f"- {_date(e['when'])} {e['name']}: {verdict}")
            learned.append(f"+ Logged {e['name']}: {verdict} (offline mode, no taste update)")
    if recent:
        profile = profile.replace("## Recent dates\n", "## Recent dates\n" + "\n".join(recent) + "\n", 1)
    return ProfileUpdate(profile_md=profile, learned=learned or ["~ Nothing new to learn"])
