"""Run Lab 8 test cases 1-4 against the real AI and write a report.

    .venv/bin/python -m scripts.run_test_cases                     # all four, model from config.json
    .venv/bin/python -m scripts.run_test_cases --model claude-sonnet-5-5
    .venv/bin/python -m scripts.run_test_cases --case 1 --case 4

It drives the same /api endpoints the web app uses, in a scratch data folder, so
your real couple in data/ is never touched. Each check prints as:
    PASS / FAIL   checked automatically
    LOOK          needs a human to read the output (it's in the report)
The full report, with every pick and reason, is saved to logs/test_runs/.
Case 5 (booking) is simulated, so it's a manual check in the app: see TEST_CASES.md.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).parent.parent
RUNS = ROOT / "logs" / "test_runs"

HISTORY = ["Violet Hour", "Lula", "Avec", "Kumiko", "Elske", "Green Mill", "Girl & the Goat", "dim", "talk"]
NEIGHBORHOODS = ["Logan Square", "West Loop", "Wicker Park", "River North", "Pilsen", "Uptown",
                 "Andersonville", "Avondale", "Bridgeport", "Fulton Market"]
NOISE_WORDS = re.compile(r"quiet|loud|crowd|calm|noise|noisy|busy|hushed|intimate|talk", re.I)


def next_weekday(weekday: int) -> date:          # 5 = Saturday, 6 = Sunday
    today = date.today()
    return today + timedelta(days=((weekday - today.weekday()) % 7) or 7)


def section(profile: str, name: str) -> str:
    m = re.search(rf"## {name}[^\n]*\n(.*?)(?=\n## |\Z)", profile, re.S)
    return m.group(1) if m else ""


class Runner:
    def __init__(self, client, store):
        self.c, self.store = client, store
        self.results, self.notes = [], []

    # --- helpers
    def post(self, path, body=None):
        r = self.c.post(path, json=body or {})
        assert r.status_code == 200, f"{path} -> {r.status_code}: {r.get_data(as_text=True)[:300]}"
        return r.get_json()

    def check(self, case, name, ok, detail=""):
        status = "LOOK" if ok is None else ("PASS" if ok else "FAIL")
        self.results.append((case, status, name, detail))
        print(f"  {status:4}  {name}" + (f"  ({detail})" if detail else ""))

    def note(self, case, title, body):
        self.notes.append((case, title, body))

    def recommend(self, **plan):
        t = time.monotonic()
        res = self.post("/api/recommend", {"note": "", "exclude": [], "vegetarian": False, **plan})
        res["secs"] = round(time.monotonic() - t, 1)
        return res

    def picks_md(self, res):
        lines = [f"Search: {res['found']} found → {res['kept']} passed the rules"
                 f"{' (widened)' if res['widened'] else ''} · source: {res['source']} · {res['secs']}s",
                 "Searches: " + " · ".join(f"“{q}”" for q in res["queries"])]
        for p in res["picks"]:
            lines.append(f"\n- **{p['name']}** ({p['kind']}, {p['price']}, {p['rating']}★, ~{p['return_chance']}%) — "
                         f"*{p['headline']}*\n  {p['why']}" + (f"\n  ⚠ {p['heads_up']}" if p["heads_up"] else ""))
        return "\n".join(lines)

    # --- the cases
    def case1(self):
        print("\nCase 1 · Typical: demo couple, Sat 7:30 PM, Wicker Park, $$, cozy, vegetarian")
        self.post("/api/demo")
        res = self.recommend(date=next_weekday(5).isoformat(), time="7:30 PM", location="Wicker Park",
                             budgets=["$$"], vibes=["cozy"], vegetarian=True)
        picks = res["picks"]
        kinds = sorted(p["kind"] for p in picks)
        best = [p for p in picks if p["kind"] == "best_fit"]
        wild = [p for p in picks if p["kind"] == "wildcard"]
        self.check(1, "Claude made the picks (not the fallback)", res["source"] == "claude", "; ".join(res["notes"]))
        self.check(1, "Exactly 3 picks: 2 Best fit + 1 Wildcard", kinds == ["best_fit", "best_fit", "wildcard"], str(kinds))
        self.check(1, "All picks within budget ($$)", all(p["price"] in ("$$", "?") for p in picks),
                   ", ".join(f"{p['name']} {p['price']}" for p in picks))
        cites = [p["name"] for p in best if any(h.lower() in (p["why"] + p["headline"]).lower() for h in HISTORY)]
        self.check(1, "Every Best fit cites the couple's history", len(cites) == len(best) > 0,
                   f"{len(cites)} of {len(best)}")
        if best and wild and all(p["return_chance"] is not None for p in picks):
            self.check(1, "Wildcard % is below both Best fits",
                       all(wild[0]["return_chance"] < b["return_chance"] for b in best),
                       ", ".join(f"{p['name']} {p['return_chance']}%" for p in picks))
        self.check(1, "No loud rooms; no invented details (read the reasons)", None)
        self.note(1, "Picks", self.picks_md(res))

    def case2(self):
        print("\nCase 2 · Typical: fresh couple onboarding")
        seeds = {s["name"]: s["id"] for s in self.c.get("/api/seeds").get_json()["seeds"]}
        both_love = ["Kumiko", "The Violet Hour", "Avec"]
        maya_only = ["Big Star", "Mi Tocaya Antojeria"]
        both_hate = ["Au Cheval", "Bavette's Bar & Boeuf"]
        ratings = {}
        for name, sid in seeds.items():
            if name in both_love:
                ratings[sid] = {"a": "heart", "b": "heart"}
            elif name in both_hate:
                ratings[sid] = {"a": "hate", "b": "hate"}
            else:   # Maya-only picks, and everything else: Maya likes it, Sam doesn't
                ratings[sid] = {"a": "heart", "b": "hate"}
        res = self.post("/api/onboard", {"ratings": ratings, "partners": ["Maya", "Sam"]})
        prof = res["profile"]
        shared, differ = section(prof, "Shared loves"), section(prof, "Where they differ")
        self.check(2, "Claude wrote the profile (not the fallback)", not res.get("error"), res.get("error") or "")
        self.check(2, "Shared loves cites Kumiko, The Violet Hour or Avec",
                   any(n in shared for n in ("Kumiko", "Violet Hour", "Avec")))
        self.check(2, "Where they differ names Maya's Mexican / taco picks",
                   "Maya" in differ and re.search(r"mexican|taco|big star|mi tocaya", differ, re.I) is not None)
        self.check(2, "No neighborhood recorded as a taste in Shared loves",
                   not any(n in shared for n in NEIGHBORHOODS))
        self.check(2, "Diners and steakhouses are not under Shared loves",
                   re.search(r"diner|steak|au cheval|bavette", shared, re.I) is None)
        self.check(2, "Nothing invented beyond the ratings (read the profile)", None)
        self.note(2, "First profile", prof + "\n\nWhat the app showed:\n" + "\n".join(res["learned"]))

    def case3(self):
        print("\nCase 3 · Edge: demo couple, Sun 9 PM, River North, $ only, adventurous, vegetarian + messy note")
        self.post("/api/demo")
        plan = dict(date=next_weekday(6).isoformat(), time="9:00 PM", location="River North",
                    budgets=["$"], vibes=["adventurous"], vegetarian=True)
        r1 = self.recommend(**plan)
        self.check(3, "First round obeys the $ budget", all(p["price"] in ("$", "?") for p in r1["picks"]),
                   ", ".join(f"{p['name']} {p['price']}" for p in r1["picks"]) or "no picks")
        self.check(3, "Never more than 3 picks", len(r1["picks"]) <= 3, f"{len(r1['picks'])} picks, widened={r1['widened']}")
        note = "idk somewhere not too loud?? sam hates crowds lol"
        r2 = self.recommend(**plan, note=note, exclude=[p["id"] for p in r1["picks"]])
        overlap = {p["id"] for p in r1["picks"]} & {p["id"] for p in r2["picks"]}
        self.check(3, "Generate more shows no repeats", not overlap, ", ".join(overlap))
        self.check(3, "Second round obeys the $ budget", all(p["price"] in ("$", "?") for p in r2["picks"]))
        responds = [p["name"] for p in r2["picks"] if NOISE_WORDS.search(p["why"] + " " + p["heads_up"] + " " + p["headline"])]
        self.check(3, "Reasons respond to the note (mention quiet, crowds or noise)",
                   len(responds) == len(r2["picks"]) > 0, f"{len(responds)} of {len(r2['picks'])}")
        self.note(3, "Round 1", self.picks_md(r1))
        self.note(3, f"Round 2 · Generate more with note: “{note}”", self.picks_md(r2))

    def case4(self):
        print("\nCase 4 · Failure (Lab 7 #1): split verdict, then a skipped review")
        self.post("/api/demo")
        sat = next_weekday(5)
        res = self.recommend(date=sat.isoformat(), time="8:00 PM", location="West Loop",
                             budgets=["$$", "$$$"], vibes=["lively"])
        p = res["picks"][0]
        self.post("/api/pick", {"session_id": res["session_id"], "place_id": p["id"], "name": p["name"], "kind": p["kind"]})
        bid = self.post("/api/book", {"session_id": res["session_id"], "place_id": p["id"], "name": p["name"],
                                      "kind": p["kind"], "date": sat.isoformat(), "time": "8:00 PM"})["booking_id"]
        when = f"{sat.isoformat()}T20:00:00"
        rev = self.post("/api/review", {"booking_id": bid, "place_id": p["id"], "name": p["name"], "kind": p["kind"],
                                        "when": when, "verdict": "split", "answers": {"a": "yes", "b": "no"},
                                        "reasons": {"a": None, "b": "Too loud"}})
        fb = [e for e in self.store.events() if e["type"] == "feedback" and e["booking_id"] == bid]
        self.check(4, "Saved as a split, not a joint yes",
                   bool(fb) and fb[-1].get("verdict") == "split" and fb[-1]["would_return"] == {"Maya": True, "Sam": False},
                   json.dumps(fb[-1]["would_return"]) if fb else "no feedback event")
        self.check(4, "Sam's reason is recorded", bool(fb) and fb[-1]["reasons"].get("Sam") == "Too loud")
        # Match on the date, not the name: Google's name ("avec Restaurant") and the profile's ("Avec") differ,
        # and a venue can already be a shared love from an earlier date.
        prof, d = rev["profile"], sat.strftime("%m/%d")
        shared = section(prof, "Shared loves")
        self.check(4, f"The {d} split is NOT counted as a shared love", d not in shared)
        self.check(4, f"The {d} split is recorded elsewhere (differ / watch / avoid / recent)",
                   d in prof.replace(shared, ""))
        self.check(4, "If the venue was already a shared love, the profile still makes sense (read it)", None)
        self.note(4, f"Booked and reviewed: {p['name']} (Maya yes, Sam no: too loud)", self.picks_md(res))
        self.note(4, "Profile after the split", prof + "\n\nWhat the app showed:\n" + "\n".join(rev["learned"]))

        nxt = self.recommend(date=next_weekday(5).isoformat(), time="7:30 PM", location="West Loop",
                             budgets=["$$", "$$$"], vibes=["cozy"])
        self.check(4, "Next picks steer away from loud rooms for Sam (read the reasons)", None)
        self.note(4, "Next plan after the split (cozy, West Loop)", self.picks_md(nxt))

        q = nxt["picks"][0]
        bid2 = self.post("/api/book", {"session_id": nxt["session_id"], "place_id": q["id"], "name": q["name"],
                                       "kind": q["kind"], "date": sat.isoformat(), "time": "7:30 PM"})["booking_id"]
        before = self.store.load_profile()
        skip = self.post("/api/review", {"booking_id": bid2, "place_id": q["id"], "name": q["name"], "kind": q["kind"],
                                         "when": f"{sat.isoformat()}T19:30:00", "verdict": "missing",
                                         "answers": {"a": None, "b": None}, "reasons": {"a": None, "b": None}})
        self.check(4, "Skipped review saved as missing (checkin_skipped)",
                   any(e["type"] == "checkin_skipped" and e["booking_id"] == bid2 for e in self.store.events()))
        self.check(4, "Skip made no profile-update AI call", not any(c["step"] == "update_profile" for c in skip["ai_calls"]))
        self.check(4, "Profile unchanged after the skip", self.store.load_profile() == before)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--case", type=int, action="append", choices=[1, 2, 3, 4], help="run only this case (repeatable)")
    ap.add_argument("--model", help="override the model in config.json for this run")
    args = ap.parse_args()

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    scratch = RUNS / f"data-{stamp}"
    scratch.mkdir(parents=True, exist_ok=True)
    os.environ["DATE_NIGHT_DATA"] = str(scratch)           # set before the app is imported
    if args.model:
        os.environ["DATE_NIGHT_MODEL"] = args.model
    sys.path.insert(0, str(ROOT))
    import config
    import llm
    import server
    import store

    model = config.load()["model"]
    if not llm.available():
        sys.exit("Real AI is off: add ANTHROPIC_API_KEY to .env and set use_real_ai to true in config.json.")
    print(f"Running test cases on {model} (scratch data: {scratch.relative_to(ROOT)})")

    run = Runner(server.app.test_client(), store)
    started = time.monotonic()
    for n in args.case or [1, 2, 3, 4]:
        try:
            getattr(run, f"case{n}")()
        except Exception as e:                              # keep going so one broken case doesn't hide the rest
            run.check(n, "Case ran to the end", False, f"{type(e).__name__}: {e}")
    secs = round(time.monotonic() - started)

    counts = {s: sum(1 for r in run.results if r[1] == s) for s in ("PASS", "FAIL", "LOOK")}
    report = RUNS / f"{stamp}-{model}.md"
    lines = [f"# Test run · {model} · {datetime.now():%b %d %Y, %I:%M %p}",
             f"\n{counts['PASS']} passed · {counts['FAIL']} failed · {counts['LOOK']} to read · {secs}s\n",
             "| Case | Result | Check | Detail |", "|---|---|---|---|"]
    lines += [f"| {c} | {s} | {n} | {d} |" for c, s, n, d in run.results]
    for c, title, body in run.notes:
        lines += [f"\n## Case {c} · {title}\n", body]
    report.write_text("\n".join(lines) + "\n")
    print(f"\n{counts['PASS']} passed · {counts['FAIL']} failed · {counts['LOOK']} to read by hand · {secs}s")
    print(f"Report: {report.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
