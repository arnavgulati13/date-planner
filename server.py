"""Date Night: the backend. Run with:  .venv/bin/python server.py   then open http://localhost:8000

It serves the web app in web/ and a few /api endpoints that run the real pipeline:
Claude writes searches -> Google Places finds venues -> code filters them -> Claude picks 3,
and after each date Claude rewrites the couple's memory. Your API keys stay here, in .env;
the browser never sees them. Booking is a hand-off: the couple books on the venue's own booking page.
"""
from __future__ import annotations

import contextvars
import functools
import json
import secrets
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

from dotenv import load_dotenv
from flask import Flask, jsonify, request, session

load_dotenv()

import accounts  # noqa: E402
import booking  # noqa: E402
import ailog  # noqa: E402
import config  # noqa: E402
import filter as constraint_filter  # noqa: E402
import geo  # noqa: E402
import llm  # noqa: E402
import places  # noqa: E402
import store  # noqa: E402
from scripts import seed_demo  # noqa: E402

app = Flask(__name__, static_folder="web", static_url_path="")


def _secret_key() -> str:
    """Signs the login cookie. Uses SECRET_KEY if set; otherwise makes one once and keeps it on the
    data volume, so logins survive restarts without any extra setup."""
    if os.getenv("SECRET_KEY"):
        return os.environ["SECRET_KEY"]
    f = store.DATA / ".secret_key"
    if not f.exists():
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(secrets.token_hex(32))
    return f.read_text().strip()


app.secret_key = _secret_key()
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=bool(os.getenv("PORT")),          # https on Railway; plain http locally
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),          # "stay logged in"
)


@app.before_request
def _load_couple():
    """Every request works on the logged-in couple's folder, or on nobody's."""
    username = session.get("couple")
    store.use_couple(username if accounts.exists(username) else None)
    ailog.start_capture()


def couple_required(view):
    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        if not store.current_username():
            return jsonify(error="Log in first."), 401
        return view(*args, **kwargs)
    return wrapper


def _log_in(username: str) -> None:
    session.clear()
    session["couple"] = username
    session.permanent = True
    store.use_couple(username)


@app.get("/healthz")
def healthz():
    """For Railway's health check; never behind the password."""
    return jsonify(ok=True)


def reply(**body):
    """Every API answer also carries the AI calls it made, for the on-screen log."""
    # The model name stays in logs/ai_log.jsonl; the browser never gets it.
    calls = [{k: v for k, v in c.items() if k not in ("model", "effort", "error_detail")} for c in ailog.captured()]
    return jsonify(**body, ai_calls=calls)


@app.get("/")
def index():
    return app.send_static_file("index.html")


# ------------------------------------------------------------------ status + setup

@app.get("/api/status")
def status():
    cfg = config.load()
    a, b = store.partner_names()
    return reply(
        use_real_ai=cfg["use_real_ai"],
        ai_live=llm.available(), places_live=places.live(),
        couple=store.load_couple() is not None, partners=[a, b],
    )


# ------------------------------------------------------------------ accounts

def _me() -> dict:
    username = store.current_username()
    if not username:
        return {"logged_in": False}
    couple = store.load_couple() or {}
    partners = couple.get("partners", [])
    vegetarian = any(d.lower() in ("vegetarian", "vegan") for p in partners for d in p.get("dietary", []))
    # A booked date that has happened and hasn't been reviewed: ask about it before the next plan.
    pending = store.pending_checkin()
    return {"logged_in": True, "username": username, "demo": username == accounts.DEMO,
            "partners": list(store.partner_names()), "onboarded": bool(store.load_profile()),
            "vegetarian": vegetarian, "pending_review": pending,
            "food_needs": [{"name": p["name"], "dietary": p.get("dietary", [])} for p in partners if p.get("dietary")]}


@app.get("/api/me")
def me():
    return reply(**_me())


@app.post("/api/signup")
def signup():
    b = request.get_json()
    error = accounts.create(b.get("username"), b.get("password"), b.get("name_a"), b.get("name_b"))
    if error:
        return jsonify(error=error), 400
    _log_in(b["username"].strip().lower())
    store.log("account_created")
    return reply(**_me())


@app.post("/api/login")
def login():
    b = request.get_json()
    username = (b.get("username") or "").strip().lower()
    if not accounts.verify(username, b.get("password")):
        return jsonify(error="That username and password don't match. Try again."), 401
    _log_in(username)
    return reply(**_me())


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/seeds")
def seeds():
    venues = json.loads(places.SAMPLE.read_text())
    return reply(seeds=[{"id": v["place_id"], "name": v["name"], "type": v["type"], "hood": v["neighborhood"]}
                        for v in venues if v.get("seed")])


@app.post("/api/onboard")
@couple_required
def onboard():
    """Set up (or redo) the couple: each partner's basics, their ratings, and Claude's first profile."""
    body = request.get_json()
    names = list(store.partner_names())
    basics = body.get("basics") or {}
    venues = {v["place_id"]: v for v in json.loads(places.SAMPLE.read_text())}
    store.reset()
    store.save_couple({"partners": [
        {"name": n, "dietary": basics.get(k, {}).get("dietary", []), "never": basics.get(k, {}).get("never", []),
         "vibe": basics.get(k, {}).get("vibe", 5),
         "cuisines": [x.strip() for x in str(basics.get(k, {}).get("favorites") or "").split(",") if x.strip()]}
        for n, k in zip(names, ("a", "b"))]})
    for place_id, r in body["ratings"].items():
        v = venues[place_id]
        for who, rating in zip(names, (r.get("a"), r.get("b"))):
            if rating in ("heart", "hate"):          # "not been" teaches nothing, so it isn't logged
                store.log("seed_swipe", partner=who, place_id=place_id, name=v["name"],
                          venue_type=v["type"], liked=rating == "heart")
    result, err = llm.update_profile("", store.events())
    store.save_profile(result.profile_md)
    store.log("profile_updated", learned=result.learned)
    return reply(learned=result.learned, profile=result.profile_md, error=err)


@app.post("/api/demo")
def demo():
    """'Try the demo': log in as Maya & Sam, with a fresh copy of their five past dates and profile."""
    accounts.ensure_demo()
    _log_in(accounts.DEMO)
    seed_demo.seed()
    return reply(partners=list(store.partner_names()), profile=store.load_profile(), **{"me": _me()})


# ------------------------------------------------------------------ plan -> picks

def _request(body: dict) -> store.DateRequest:
    when = datetime.strptime(f"{body['date']} {body['time']}", "%Y-%m-%d %I:%M %p")
    budgets = sorted(len(x) for x in body["budgets"])
    return store.DateRequest(when=when, area=body["location"], price_min=budgets[0], price_max=budgets[-1],
                             vibes=body.get("vibes", []), vegetarian=bool(body.get("vegetarian")),
                             notes=body.get("note", ""), craving=(body.get("craving") or "").strip())


def _search_all(queries: list[str], prices: range, area: str) -> list[dict]:
    """Run the searches at the same time instead of one after another. Each runs in a copy of this
    request's context, so its log lines still reach the on-screen log."""
    with ThreadPoolExecutor(max_workers=len(queries) or 1) as pool:
        jobs = [pool.submit(contextvars.copy_context().run, places.search, q, prices, area) for q in queries]
        return [v for job in jobs for v in job.result()]


@app.post("/api/recommend")
@couple_required
def recommend():
    body = request.get_json()
    req = _request(body)
    exclude = set(body.get("exclude", []))
    profile = store.load_profile()
    notes = []
    t0 = time.monotonic()
    timing = {}

    q, err = llm.write_queries(profile, req)
    timing["write_searches"] = round(time.monotonic() - t0, 1)
    if err:
        notes.append(f"Searches used our backup rules. {err}.")
    queries = q.queries + [q.explore_query]
    prices = range(req.price_min, req.price_max + 1)
    t = time.monotonic()
    found = _search_all(queries, prices, req.area)
    store.log("search", queries=queries)

    visited = store.recently_visited()
    kept, dropped = constraint_filter.apply(found, req, visited)
    widened = False
    if len(kept) < 6:
        widened = True
        extra = _search_all([f"restaurant {req.area} Chicago", f"bar {req.area} Chicago"], prices, req.area)
        found = found + extra
        kept, dropped = constraint_filter.apply(found, req, visited)
    candidates = [v for v in kept if v["place_id"] not in exclude]
    for v in candidates:
        d = geo.venue_miles(v, req.area)
        v["_miles"] = round(d, 1) if d is not None else None
    timing["search_and_filter"] = round(time.monotonic() - t, 1)
    ailog.write("agent_step", tool="constraint_filter", sent={
        "venues_in": len(found), "rules": {"when": req.when.isoformat(), "budget": [req.price_min, req.price_max],
                                           "vegetarian": req.vegetarian, "min_rating": constraint_filter.MIN_RATING,
                                           "exclude_recently_visited": len(visited), "exclude_already_shown": len(exclude)}},
        returned={"kept": len(kept), "dropped_by_reason": dropped, "widened_search": widened,
                  "sent_to_ranking": min(len(candidates), 25)}, error=None)

    t = time.monotonic()
    picks, err, note = llm.recommend(profile, req, candidates[:25]) if candidates else ([], None, "")
    timing["pick_3"] = round(time.monotonic() - t, 1)
    timing["total"] = round(time.monotonic() - t0, 1)
    if err:
        notes.append(f"Picks used our backup rules. {err}.")
    session_id = uuid.uuid4().hex[:8]
    store.log("shown", session_id=session_id, place_ids=[p.place_id for p in picks],
              kinds=[p.kind for p in picks], request=req.describe())

    by_id = {v["place_id"]: v for v in candidates}
    _shown_venues.update({p.place_id: by_id[p.place_id] for p in picks})
    out = []
    for p in picks:
        v = by_id[p.place_id]
        out.append({
            "id": v["place_id"], "name": v["name"], "type": v.get("type", ""),
            "price": "$" * (v.get("price_level") or 0) or "?", "rating": v.get("rating"), "rating_count": v.get("rating_count"),
            "address": geo.clean_address(v.get("address", "")), "miles": v.get("_miles"),
            "maps_url": v.get("maps_url"), "reservable": v.get("reservable"),
            "kind": p.kind, "headline": p.headline, "why": p.why, "heads_up": p.heads_up,
            "return_chance": p.return_chance,
        })
    ailog.write("agent_step", tool="final_picks", sent={"session_id": session_id}, returned=[
        {"name": o["name"], "kind": o["kind"], "return_chance": o["return_chance"], "heads_up": o["heads_up"]} for o in out],
        error=err)
    ailog.write("agent_step", tool="timing", sent={"session_id": session_id}, returned=timing, error=None)
    return reply(session_id=session_id, queries=queries, found=len(found), kept=len(kept),
                 dropped=dropped, widened=widened, notes=notes, picks=out, note=note, timing=timing,
                 source="ai" if not err and llm.available() else "fallback",
                 places="google" if places.live() else "sample")


_shown_venues: dict[str, dict] = {}     # venues shown as picks, so /api/booking can look them up


@app.post("/api/booking")
@couple_required
def booking_info():
    """Where each pick takes bookings. Called after the picks are on screen, so picks aren't slower."""
    venues = [_shown_venues[i] for i in request.get_json().get("ids", []) if i in _shown_venues]
    return reply(booking=booking.lookup(venues))


# ------------------------------------------------------------------ pick, book, review

@app.post("/api/pick")
@couple_required
def pick():
    b = request.get_json()
    store.log("picked", session_id=b["session_id"], place_id=b["place_id"], name=b["name"], kind=b["kind"])
    return reply(ok=True)


@app.post("/api/book")
@couple_required
def book():
    """Records a booking so the check-in and 'visited lately' rule work. Real bookings are made by the couple
    on OpenTable, Resy or Google (the app opens the page with the details filled in); Test-mode bookings are simulated."""
    b = request.get_json()
    booking_id = uuid.uuid4().hex[:8]
    when = datetime.strptime(f"{b['date']} {b['time']}", "%Y-%m-%d %I:%M %p")
    store.log("booked", booking_id=booking_id, session_id=b.get("session_id"), place_id=b["place_id"],
              name=b["name"], when=when.isoformat(), kind=b.get("kind"), real=bool(b.get("real")),
              platform=b.get("platform"), confirmation=b.get("confirmation"), party_size=b.get("party_size"))
    return reply(booking_id=booking_id)


@app.post("/api/review")
@couple_required
def review():
    """Save each partner's answer. A split stays split. Both answers are required."""
    b = request.get_json()
    a_name, b_name = store.partner_names()
    answers = {a_name: b["answers"].get("a"), b_name: b["answers"].get("b")}
    reasons = {a_name: b["reasons"].get("a"), b_name: b["reasons"].get("b")}
    if any(ans not in ("yes", "no") for ans in answers.values()) or b["verdict"] not in ("joint_yes", "joint_no", "split"):
        return jsonify(error="Both of you need to answer before we save the review."), 400

    note = "; ".join(f"{who} said no: {why.lower()}" for who, why in reasons.items() if why)
    store.log("feedback", booking_id=b["booking_id"], place_id=b["place_id"], name=b["name"], when=b["when"],
              would_return={who: ans == "yes" for who, ans in answers.items()},
              reasons=reasons, verdict=b["verdict"], note=note, kind=b.get("kind"))

    evs = store.events()
    last = max((i for i, e in enumerate(evs) if e["type"] == "profile_updated"), default=-1)
    new = [e for e in evs[last + 1:] if e["type"] in ("feedback", "rejected", "picked", "seed_swipe")]
    # The demo's "fast-forward" reviews a date that hasn't happened yet; date the review the day after it.
    today = max(datetime.now(), datetime.fromisoformat(b["when"]) + timedelta(days=1))
    result, err = llm.update_profile(store.load_profile(), new, today=today)
    store.save_profile(result.profile_md)
    store.log("profile_updated", learned=result.learned)
    return reply(learned=result.learned, profile=result.profile_md, error=err)


@app.get("/api/profile")
@couple_required
def get_profile():
    return reply(profile=store.load_profile(), partners=list(store.partner_names()))


@app.post("/api/profile")
@couple_required
def save_profile():
    """The couple corrects what the app believes about them. Their edit replaces the profile as written."""
    md = (request.get_json().get("profile") or "").strip()
    if not md:
        return jsonify(error="The profile can't be empty."), 400
    store.save_profile(md)
    store.log("profile_edit")
    return reply(profile=store.load_profile())


@app.post("/api/log")
def ui_log():
    """Clicks and decisions from the web app, written to the same testing log as the AI calls."""
    b = request.get_json()
    ailog.write("ui_event", event=b.get("event"), data=b.get("data"))
    return jsonify(ok=True)


if __name__ == "__main__":
    cfg = config.load()
    print(f"\n  Date Night is running: open http://localhost:{cfg['port']}\n"
          f"  Model: {cfg['model']} · real AI {'on' if llm.available() else 'off'} · "
          f"Places {'live' if places.live() else 'sample venues'}\n")
    # Locally: localhost on config.json's port. On a host that sets PORT (like Railway), the production
    # start command in railway.json runs gunicorn instead, but this keeps `python server.py` working there too.
    port = int(os.getenv("PORT") or cfg["port"])
    app.run(host="0.0.0.0" if os.getenv("PORT") else "127.0.0.1", port=port, debug=False)
