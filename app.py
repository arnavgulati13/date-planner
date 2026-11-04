"""Date Night: the Streamlit app. Run with:  streamlit run app.py"""
from __future__ import annotations

import json
import uuid
from datetime import date, datetime, time, timedelta

import streamlit as st
from dotenv import load_dotenv

load_dotenv()

import filter as constraint_filter  # noqa: E402
import llm  # noqa: E402
import places  # noqa: E402
import store  # noqa: E402

st.set_page_config(page_title="Date Night", page_icon="🍷", layout="wide")

st.markdown("""
<style>
.badge {display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;color:#fff;}
.best {background:#F0703C;} .wild {background:#7C5CFF;}
.venue-name {font-size:22px;font-weight:700;margin:6px 0 0 0;}
.meta {color:#6b7280;font-size:14px;margin-bottom:8px;}
.headline {font-weight:600;font-size:16px;margin:4px 0;}
.learned {background:#FFF8E1;color:#3D2E00;border:1px solid #E0A800;border-radius:12px;padding:14px 18px;line-height:1.7;}
.small {color:#6b7280;font-size:13px;}
</style>
""", unsafe_allow_html=True)

VIBES = ["cozy", "lively", "romantic", "adventurous", "chill", "dressy", "live music"]
CUISINES = ["Italian", "Japanese", "Mexican", "Korean", "Thai", "Indian", "Mediterranean",
            "New American", "French", "Chinese", "Steakhouse", "Pizza", "Cocktail bars", "Wine bars", "Beer bars"]
NEVER = ["Seafood", "Spicy food", "Loud rooms", "Long waits", "Sports bars", "Chain restaurants"]
REJECT_REASONS = ["too pricey", "too far", "not the vibe", "been there", "not tonight"]
S = st.session_state
S.setdefault("stage", "form")
S.setdefault("rejected", [])
S.setdefault("fast_forward", False)


def dollars(n: int | None) -> str:
    return "$" * n if n else "$?"


# ------------------------------------------------------------------ sidebar

def sidebar() -> str:
    with st.sidebar:
        st.title("🍷 Date Night")
        couple = store.load_couple()
        if couple:
            a, b = store.partner_names()
            st.caption(f"Planning for **{a} & {b}**")
        page = st.radio("Go to", ["Plan a date", "Our profile", "Setup"], label_visibility="collapsed")
        st.divider()
        st.caption("Running mode")
        st.caption(("🟢 Claude: live" if llm.available() else "🟡 Claude: offline heuristic") +
                   "  \n" + ("🟢 Places: live search" if places.live() else "🟡 Places: sample venues"))
        if couple:
            S.fast_forward = st.toggle("⏩ Demo: jump to after the date", value=S.fast_forward,
                                       help="Treat booked dates as already happened, so the check-in shows now.")
    return page


# ------------------------------------------------------------------ setup / onboarding

def setup_page():
    st.header("Setup")
    if store.load_couple():
        st.success("You're set up. Use **Plan a date** to get going.")
        c1, c2 = st.columns(2)
        if c1.button("Load the demo couple (overwrites data)"):
            from scripts.seed_demo import seed
            seed()
            S.clear()
            st.rerun()
        if c2.button("Start over (delete all data)", type="secondary"):
            store.reset()
            S.clear()
            st.rerun()
        return
    st.write("New here? Load a demo couple with some history, or onboard your own.")
    if st.button("Load the demo couple", type="primary"):
        from scripts.seed_demo import seed
        seed()
        st.rerun()
    st.divider()
    onboarding()


def onboarding():
    st.subheader("1 · Tell us your tastes")
    cols = st.columns(2)
    partners = []
    for i, col in enumerate(cols):
        with col, st.container(border=True):
            name = st.text_input("Name", key=f"name{i}", placeholder=["Maya", "Sam"][i])
            partners.append({
                "name": name or ["Partner A", "Partner B"][i],
                "cuisines": st.multiselect("Cuisines you love", CUISINES, key=f"cui{i}"),
                "never": st.multiselect("Never, please", NEVER, key=f"nev{i}"),
                "vibe": st.slider("Vibe", 0, 10, 4, key=f"vibe{i}", help="0 = cozy and quiet, 10 = loud and lively"),
                "dietary": st.multiselect("Dietary", ["vegetarian", "vegan", "gluten-free"], key=f"diet{i}"),
                "dealbreakers": st.text_input("Any dealbreakers?", key=f"deal{i}"),
            })
    home = st.text_input("Home neighbourhood (just pre-fills the area; you can go anywhere)", "Logan Square")

    st.subheader("2 · Swipe on some Chicago spots")
    st.caption("Tap ♥ or ✕ for each partner. Skip any you don't know. This teaches us your *taste*, not where you go.")
    seeds = [v for v in json.loads(places.SAMPLE.read_text()) if v.get("seed")]
    grid = st.columns(3)
    swipes = []
    for j, v in enumerate(seeds):
        with grid[j % 3], st.container(border=True):
            st.markdown(f"**{v['name']}**  \n<span class='small'>{v['type']} · {dollars(v['price_level'])} · {v['summary']}</span>",
                        unsafe_allow_html=True)
            for i, p in enumerate(partners):
                choice = st.segmented_control(p["name"], ["♥", "✕"], key=f"sw{j}_{i}")
                if choice:
                    swipes.append((p["name"], v, choice == "♥"))

    if st.button("Build our profile", type="primary"):
        store.save_couple({"partners": partners, "home_area": home})
        for who, v, liked in swipes:
            store.log("seed_swipe", partner=who, place_id=v["place_id"], name=v["name"],
                      venue_type=v["type"], liked=liked)
        with st.spinner("Building your first profile…"):
            result, err = llm.update_profile("", store.events())
        store.save_profile(result.profile_md)
        store.log("profile_updated", learned=result.learned)
        if err:
            st.warning(f"Used the offline heuristic: {err}")
        S.learned = result.learned
        st.rerun()


# ------------------------------------------------------------------ plan a date

def run_pipeline(req: store.DateRequest) -> dict:
    profile = store.load_profile()
    notes = []
    with st.status("Finding your options…", expanded=True) as status:
        st.write("✍️ Writing searches from your profile…")
        q, err = llm.write_queries(profile, req)
        if err:
            notes.append(f"Searches: offline heuristic ({err})")
        queries = q.queries + [q.explore_query]
        st.write("🔎 Searching: " + " · ".join(f"“{x}”" for x in queries))
        prices = range(req.price_min, req.price_max + 1)
        found = [v for x in queries for v in places.search(x, prices)]
        store.log("search", queries=queries)

        st.write(f"🧹 Filtering {len(found)} results against your hard rules…")
        visited = store.recently_visited()
        kept, dropped = constraint_filter.apply(found, req, visited)
        widened = False
        if len(kept) < 6:
            widened = True
            extra = places.search(f"restaurant {req.area} Chicago", prices) + places.search(f"bar {req.area} Chicago", prices)
            kept, dropped = constraint_filter.apply(found + extra, req, visited)

        st.write(f"💡 Picking from {len(kept)} candidates…")
        picks, err = llm.recommend(profile, req, kept[:25]) if kept else ([], None)
        if err:
            notes.append(f"Ranking: offline heuristic ({err})")
        status.update(label="Here are your options", state="complete", expanded=False)

    session_id = uuid.uuid4().hex[:8]
    store.log("shown", session_id=session_id, place_ids=[p.place_id for p in picks],
              kinds=[p.kind for p in picks], request=req.describe())
    return {"session_id": session_id, "queries": queries, "found": len(found), "kept": len(kept),
            "dropped": dropped, "widened": widened, "notes": notes,
            "picks": [p.model_dump() for p in picks], "venues": {v["place_id"]: v for v in kept}}


def checkin(booking: dict):
    a, b = store.partner_names()
    st.header(f"How was {booking['name']}?")
    st.caption(f"{datetime.fromisoformat(booking['when']):%A %B %d} · one quick check-in before the next plan")
    with st.container(border=True):
        ra = st.segmented_control(f"{a}: would you go back?", ["Yes", "No"], key="ci_a")
        rb = st.segmented_control(f"{b}: would you go back?", ["Yes", "No"], key="ci_b")
        note = st.text_input("Anything memorable? (optional)", placeholder="e.g. loved the omakase counter, too loud after 9")
        c1, c2 = st.columns([1, 3])
        if c1.button("Save", type="primary", disabled=not (ra and rb)):
            store.log("feedback", booking_id=booking["booking_id"], place_id=booking["place_id"],
                      name=booking["name"], when=booking["when"], would_return={a: ra == "Yes", b: rb == "Yes"},
                      note=note, kind=booking.get("kind"))
            update_memory()
            st.rerun()
        if c2.button("We didn't end up going"):
            store.log("checkin_skipped", booking_id=booking["booking_id"])
            st.rerun()


def update_memory():
    evs = store.events()
    last = max((i for i, e in enumerate(evs) if e["type"] == "profile_updated"), default=-1)
    new = [e for e in evs[last + 1:] if e["type"] in ("feedback", "rejected", "picked", "seed_swipe")]
    with st.spinner("Updating what we know about you two…"):
        result, err = llm.update_profile(store.load_profile(), new)
    store.save_profile(result.profile_md)
    store.log("profile_updated", learned=result.learned)
    S.learned = result.learned
    S.learned_err = err


def show_learned():
    if S.get("learned"):
        lines = "<br>".join(S.learned)
        st.markdown(f"<div class='learned'><b>🧠 What we learned</b><br>{lines}</div>", unsafe_allow_html=True)
        if S.get("learned_err"):
            st.caption(f"Offline heuristic used: {S.learned_err}")
        if st.button("Got it"):
            S.learned = None
            st.rerun()
        st.write("")


def plan_page():
    if not store.load_couple():
        st.info("Start in **Setup**: load the demo couple or onboard yourselves.")
        return
    now = datetime.now() + timedelta(days=30) if S.fast_forward else None
    pending = store.pending_checkin(now)
    if pending:
        checkin(pending)
        return
    if S.get("flash"):
        st.success(S.pop("flash"))
    show_learned()
    {"form": plan_form, "results": results, "booked": booked}[S.stage]()


def plan_form():
    couple = store.load_couple()
    st.header("Plan a date")
    with st.form("plan"):
        c1, c2, c3 = st.columns(3)
        d = c1.date_input("When", date.today() + timedelta(days=(5 - date.today().weekday()) % 7 or 7))
        t = c2.time_input("Time", time(19, 30), step=900)
        area = c3.text_input("Where", couple.get("home_area", ""), placeholder="a neighbourhood or address")
        c4, c5 = st.columns(2)
        lo, hi = c4.select_slider("Budget", ["$", "$$", "$$$", "$$$$"], value=("$$", "$$$"))
        occasion = c5.segmented_control("Occasion", ["casual", "special"], default="casual")
        vibes = st.pills("Vibe", VIBES, selection_mode="multi")
        veg = any("vegetarian" in p.get("dietary", []) or "vegan" in p.get("dietary", []) for p in couple["partners"])
        vegetarian = st.checkbox("Needs good vegetarian options", value=veg)
        notes = st.text_input("Anything else?", placeholder="e.g. somewhere we can walk to after")
        go = st.form_submit_button("Find dates", type="primary")
    if go:
        if not area.strip():
            st.error("Tell us where you'd like to go.")
            return
        S.req = store.DateRequest(when=datetime.combine(d, t), area=area.strip(), price_min=len(lo), price_max=len(hi),
                                  vibes=vibes or [], occasion=occasion or "casual", notes=notes, vegetarian=vegetarian)
        S.result = run_pipeline(S.req)
        S.rejected = []
        S.stage = "results"
        st.rerun()


def results():
    req, res = S.req, S.result
    top = st.columns([4, 1])
    top[0].header(f"{req.when:%a %b %d, %I:%M %p} · {req.area}")
    if top[1].button("← New search"):
        S.stage = "form"
        st.rerun()
    with st.expander(f"How we got here: {res['found']} found → {res['kept']} passed your rules → 3 picked"):
        st.write("**Searches the AI wrote:** " + " · ".join(f"“{q}”" for q in res["queries"]))
        if res["dropped"]:
            st.write("**Filtered out:** " + ", ".join(f"{n} {r}" for r, n in res["dropped"].items()))
        if res["widened"]:
            st.write("Not many options right there, so we widened the search.")
        for n in res["notes"]:
            st.caption(n)
    if not res["picks"]:
        st.warning("Nothing passed your rules for that time and place. Try a different time, area or budget.")
        return

    picks = [p for p in res["picks"] if p["place_id"] not in S.rejected]
    cols = st.columns(3)
    for col, p in zip(cols, picks):
        v = res["venues"][p["place_id"]]
        with col, st.container(border=True):
            badge = "<span class='badge wild'>✦ WILDCARD</span>" if p["kind"] == "wildcard" else "<span class='badge best'>★ BEST FIT</span>"
            st.markdown(f"{badge}<div class='venue-name'>{v['name']}</div>"
                        f"<div class='meta'>{v.get('type', '')} · {dollars(v.get('price_level'))} · {v.get('rating', '?')}★ · {v.get('address', '')}</div>"
                        f"<div class='headline'>{p['headline']}</div>", unsafe_allow_html=True)
            st.write(p["why"])
            if p["heads_up"]:
                st.caption(f"⚠️ {p['heads_up']}")
            b1, b2 = st.columns(2)
            if b1.button("Pick this", key=f"pick{p['place_id']}", type="primary", use_container_width=True):
                store.log("picked", session_id=res["session_id"], place_id=v["place_id"], name=v["name"], kind=p["kind"])
                S.selected = {**p, "venue": v}
                S.stage = "booked"
                st.rerun()
            with b2.popover("Not it", use_container_width=True):
                reason = st.pills("Why?", REJECT_REASONS, key=f"why{p['place_id']}")
                if reason:
                    store.log("rejected", session_id=res["session_id"], place_id=v["place_id"], name=v["name"],
                              kind=p["kind"], reason=reason)
                    S.rejected.append(p["place_id"])
                    st.rerun()
    if not picks:
        st.info("You passed on all three. Refine below or start a new search.")

    with st.form("refine"):
        extra = st.text_input("Refine", placeholder="e.g. somewhere walkable after, or quieter")
        if st.form_submit_button("↻ Try again") and extra:
            S.req.notes = (S.req.notes + "; " + extra).strip("; ")
            S.result = run_pipeline(S.req)
            S.rejected = []
            st.rerun()


def ics(name: str, address: str, when: datetime) -> str:
    fmt = "%Y%m%dT%H%M%S"
    return "\r\n".join([
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Date Night MVP//EN", "BEGIN:VEVENT",
        f"UID:{uuid.uuid4()}", f"DTSTAMP:{datetime.now():{fmt}}",
        f"DTSTART:{when:{fmt}}", f"DTEND:{when + timedelta(hours=2):{fmt}}",
        f"SUMMARY:Date night: {name}", f"LOCATION:{address}", "END:VEVENT", "END:VCALENDAR", ""])


def booked():
    p, v, req = S.selected, S.selected["venue"], S.req
    st.header(f"🎉 {v['name']}")
    st.caption(f"{req.when:%A %B %d at %I:%M %p} · {v.get('address', '')}")
    with st.container(border=True):
        st.write("**1. Reserve a table**")
        c1, c2, c3 = st.columns(3)
        if v.get("maps_url"):
            c1.link_button("Open in Google Maps (Reserve a table)", v["maps_url"], use_container_width=True)
        if v.get("website"):
            c2.link_button("Venue website", v["website"], use_container_width=True)
        c3.download_button("Add to calendar (.ics)", ics(v["name"], v.get("address", ""), req.when),
                           file_name="date-night.ics", mime="text/calendar", use_container_width=True)
        if v.get("reservable") is False:
            st.caption("⚠️ Google lists this place as not taking reservations. Plan to walk in.")
        st.write("**2. Tell us once it's booked**")
        if st.button("We booked it ✓", type="primary"):
            store.log("booked", booking_id=uuid.uuid4().hex[:8], session_id=S.result["session_id"],
                      place_id=v["place_id"], name=v["name"], when=req.when.isoformat(), kind=p["kind"])
            S.stage = "form"
            S.flash = f"Booked {v['name']}. Enjoy! We'll ask how it went next time you open the app."
            st.rerun()
    if st.button("← Back to the options"):
        S.stage = "results"
        st.rerun()


# ------------------------------------------------------------------ profile

def profile_page():
    if not store.load_couple():
        st.info("Start in **Setup**.")
        return
    a, b = store.partner_names()
    st.header(f"What we know about {a} & {b}")
    st.caption("This is the memory the AI reads before every recommendation and rewrites after every date. You can edit it.")
    profile = store.load_profile()
    if st.toggle("Edit"):
        edited = st.text_area("Profile", profile, height=420, label_visibility="collapsed")
        if st.button("Save changes", type="primary"):
            store.save_profile(edited)
            store.log("profile_edit")
            st.success("Saved.")
    else:
        with st.container(border=True):
            st.markdown(profile.replace("## ", "#### ") or "_Empty._")

    st.subheader("How it's going")
    cols = st.columns(4)
    for col, (k, val) in zip(cols, store.stats().items()):
        col.metric(k, val)

    with st.expander("Event log (the raw data a future ML model would train on)"):
        evs = store.events()
        st.dataframe([{"when": e["ts"], "type": e["type"], "venue": e.get("name", ""),
                       "detail": e.get("reason") or e.get("kind") or e.get("note") or ""} for e in reversed(evs)],
                     use_container_width=True, hide_index=True)
    if st.button("Rebuild profile from the event log"):
        with st.spinner("Rebuilding from scratch…"):
            result, err = llm.update_profile("", store.events())
        store.save_profile(result.profile_md)
        store.log("profile_updated", learned=result.learned)
        st.rerun()


page = sidebar()
{"Plan a date": plan_page, "Our profile": profile_page, "Setup": setup_page}[page]()
