"""Date Night: the backend. Run with:  .venv/bin/python server.py   then open http://localhost:8000

It serves the web app in web/ and a few /api endpoints that run the real pipeline:
Claude writes searches -> Google Places finds venues -> code filters them -> Claude picks 3,
and after each date Claude rewrites the couple's memory. Your API keys stay here, in .env;
the browser never sees them. Booking is still simulated (no public OpenTable/Resy API).
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta

from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

import ailog  # noqa: E402
import config  # noqa: E402
import filter as constraint_filter  # noqa: E402
import llm  # noqa: E402
import places  # noqa: E402
import store  # noqa: E402
from scripts import seed_demo  # noqa: E402

app = Flask(__name__, static_folder="web", static_url_path="")


@app.before_request
def _capture_ai_calls():
    ailog.start_capture()


def reply(**body):
    """Every API answer also carries the AI calls it made, for the on-screen log."""
    return jsonify(**body, ai_calls=ailog.captured())


@app.get("/")
def index():
    return app.send_static_file("index.html")


# ------------------------------------------------------------------ status + setup

@app.get("/api/status")
def status():
    cfg = config.load()
    a, b = store.partner_names()
    return reply(
        use_real_ai=cfg["use_real_ai"], model=cfg["model"],
        claude_live=llm.available(), places_live=places.live(),
        couple=store.load_couple() is not None, partners=[a, b],
    )


@app.get("/api/seeds")
def seeds():
    venues = json.loads(places.SAMPLE.read_text())
    return reply(seeds=[{"id": v["place_id"], "name": v["name"], "type": v["type"], "hood": v["neighborhood"]}
                        for v in venues if v.get("seed")])


@app.post("/api/onboard")
def onboard():
    """Start fresh: save the couple, log every rating, and have Claude write the first memory."""
    body = request.get_json()
    names = body.get("partners") or ["Maya", "Sam"]
    venues = {v["place_id"]: v for v in json.loads(places.SAMPLE.read_text())}
    store.reset()
    store.save_couple({"partners": [{"name": n} for n in names]})
    for place_id, r in body["ratings"].items():
        v = venues[place_id]
        for who, rating in zip(names, (r.get("a"), r.get("b"))):
            if rating:
                store.log("seed_swipe", partner=who, place_id=place_id, name=v["name"],
                          venue_type=v["type"], liked=rating == "heart")
    result, err = llm.update_profile("", store.events())
    store.save_profile(result.profile_md)
    store.log("profile_updated", learned=result.learned)
    return reply(learned=result.learned, profile=result.profile_md, error=err)


@app.post("/api/demo")
def demo():
    """Load the made-up demo couple with five past dates and a written memory."""
    seed_demo.seed()
    return reply(partners=list(store.partner_names()), profile=store.load_profile())


# ------------------------------------------------------------------ plan -> picks

def _request(body: dict) -> store.DateRequest:
    when = datetime.strptime(f"{body['date']} {body['time']}", "%Y-%m-%d %I:%M %p")
    budgets = sorted(len(x) for x in body["budgets"])
    return store.DateRequest(when=when, area=body["location"], price_min=budgets[0], price_max=budgets[-1],
                             vibes=body.get("vibes", []), vegetarian=bool(body.get("vegetarian")),
                             notes=body.get("note", ""))


@app.post("/api/recommend")
def recommend():
    body = request.get_json()
    req = _request(body)
    exclude = set(body.get("exclude", []))
    profile = store.load_profile()
    notes = []

    q, err = llm.write_queries(profile, req)
    if err:
        notes.append(f"Searches: fallback heuristic ({err})")
    queries = q.queries + [q.explore_query]
    prices = range(req.price_min, req.price_max + 1)
    found = [v for x in queries for v in places.search(x, prices)]
    store.log("search", queries=queries)

    visited = store.recently_visited()
    kept, dropped = constraint_filter.apply(found, req, visited)
    widened = False
    if len(kept) < 6:
        widened = True
        extra = places.search(f"restaurant {req.area} Chicago", prices) + places.search(f"bar {req.area} Chicago", prices)
        found = found + extra
        kept, dropped = constraint_filter.apply(found, req, visited)
    candidates = [v for v in kept if v["place_id"] not in exclude]
    ailog.write("agent_step", tool="constraint_filter", sent={
        "venues_in": len(found), "rules": {"when": req.when.isoformat(), "budget": [req.price_min, req.price_max],
                                           "vegetarian": req.vegetarian, "min_rating": constraint_filter.MIN_RATING,
                                           "exclude_recently_visited": len(visited), "exclude_already_shown": len(exclude)}},
        returned={"kept": len(kept), "dropped_by_reason": dropped, "widened_search": widened,
                  "sent_to_ranking": min(len(candidates), 25)}, error=None)

    picks, err = llm.recommend(profile, req, candidates[:25]) if candidates else ([], None)
    if err:
        notes.append(f"Ranking: fallback heuristic ({err})")
    session_id = uuid.uuid4().hex[:8]
    store.log("shown", session_id=session_id, place_ids=[p.place_id for p in picks],
              kinds=[p.kind for p in picks], request=req.describe())

    by_id = {v["place_id"]: v for v in candidates}
    out = []
    for p in picks:
        v = by_id[p.place_id]
        out.append({
            "id": v["place_id"], "name": v["name"], "type": v.get("type", ""),
            "price": "$" * (v.get("price_level") or 0) or "?", "rating": v.get("rating"),
            "address": v.get("address", ""), "maps_url": v.get("maps_url"), "reservable": v.get("reservable"),
            "kind": p.kind, "headline": p.headline, "why": p.why, "heads_up": p.heads_up,
            "return_chance": p.return_chance,
        })
    ailog.write("agent_step", tool="final_picks", sent={"session_id": session_id}, returned=[
        {"name": o["name"], "kind": o["kind"], "return_chance": o["return_chance"], "heads_up": o["heads_up"]} for o in out],
        error=err)
    return reply(session_id=session_id, queries=queries, found=len(found), kept=len(kept),
                 dropped=dropped, widened=widened, notes=notes, picks=out,
                 source="claude" if not err and llm.available() else "fallback",
                 model=llm.model(), places="google" if places.live() else "sample")


# ------------------------------------------------------------------ pick, book, review

@app.post("/api/pick")
def pick():
    b = request.get_json()
    store.log("picked", session_id=b["session_id"], place_id=b["place_id"], name=b["name"], kind=b["kind"])
    return reply(ok=True)


@app.post("/api/book")
def book():
    """Booking is simulated in the web app; this records it so the check-in and 'visited lately' rule work."""
    b = request.get_json()
    booking_id = uuid.uuid4().hex[:8]
    when = datetime.strptime(f"{b['date']} {b['time']}", "%Y-%m-%d %I:%M %p")
    store.log("booked", booking_id=booking_id, session_id=b.get("session_id"), place_id=b["place_id"],
              name=b["name"], when=when.isoformat(), kind=b.get("kind"))
    return reply(booking_id=booking_id)


@app.post("/api/review")
def review():
    """Save each partner's answer. A split stays split; a skip is 'missing' and teaches the memory nothing."""
    b = request.get_json()
    a_name, b_name = store.partner_names()
    answers = {a_name: b["answers"].get("a"), b_name: b["answers"].get("b")}
    reasons = {a_name: b["reasons"].get("a"), b_name: b["reasons"].get("b")}
    if b["verdict"] == "missing":
        store.log("checkin_skipped", booking_id=b["booking_id"], verdict="missing", partial_answers=answers)
        return reply(learned=[], profile=store.load_profile())

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
    app.run(port=cfg["port"], debug=False)
