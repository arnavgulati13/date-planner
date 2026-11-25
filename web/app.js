// Date Night web app — UI flow.
// Real mode (served by server.py with use_real_ai on): onboarding, picks and the
// post-date memory update call the backend, which runs the AI. Booking stays simulated.
// Simulated mode (opened as a file, or use_real_ai off): everything comes from
// simulated_responses.js, exactly like the Lab 7 prototype.

const S = window.SIMULATED_RESPONSES;
let A = S.couple.a, B = S.couple.b;
const screenEl = document.getElementById("screen");
const MODE = { real: false, status: null };   // set by init() from /api/status

const state = {
  screen: "onboarding",
  ratings: Object.fromEntries(S.onboardingVenues.map(v => [v.id, { a: null, b: null }])),
  memory: null,                      // built from onboarding; updated by reviews
  plan: { date: "", time: "", location: "", budgets: [], vibes: [], vegetarian: false },
  shown: [], current: [], note: "",
  selected: null, booking: null, showExternal: false,
  approved: null, found: null,       // exact booking terms approved / found by the agent
  review: { a: null, b: null, reasonA: null, reasonB: null },
  verdict: null,
  test: { slotGone: false, wrongConfirmation: false },   // Test mode switches
  local: false,                      // true while a Test-mode scenario runs on sample data
  venues: S.onboardingVenues,        // spots shown at onboarding (from the backend in real mode)
  pipeline: null, learned: [], banner: null, error: null,
  me: null,                          // the logged-in couple (from /api/me); null when signed out
  auth: { name_a: "", name_b: "", username: "", password: "" }, authError: null,
  basics: { a: { dietary: [], never: [], vibe: 5 }, b: { dietary: [], never: [], vibe: 5 } },
  metrics: { selected: 0, booked: 0, fails: 0, reviews: 0, returns: 0 },
};
const F1 = S.failureScenarios.scenario1, F2 = S.failureScenarios.scenario2;
const TERM_FIELDS = [["venue", "Venue"], ["date", "Date"], ["time", "Time"], ["partySize", "Party size"], ["deposit", "Deposit"]];

// ---------- helpers ----------
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
const venueName = id => (S.onboardingVenues.find(v => v.id === id) || {}).name;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fmtDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}
function to24(t) {
  const [, h, m, ap] = t.match(/(\d+):(\d+) (AM|PM)/);
  return `${String((+h % 12) + (ap === "PM" ? 12 : 0)).padStart(2, "0")}:${m}:00`;
}
function shiftTime(t, mins) {
  const [, h, m, ap] = t.match(/(\d+):(\d+) (AM|PM)/);
  let total = ((+h % 12) + (ap === "PM" ? 12 : 0)) * 60 + +m + mins;
  const H = Math.floor(total / 60), M = total % 60;
  return `${((H + 11) % 12) + 1}:${String(M).padStart(2, "0")} ${H >= 12 ? "PM" : "AM"}`;
}

// ---------- real bookings: hand-off links ----------
function to24h(t) { return to24(t).slice(0, 5); }     // "7:30 PM" -> "19:30"
function withParams(url, params) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

// The venue's own booking page (found on its website by the server), with the details filled in.
// Each platform names the date, time and party size differently; all of these were checked live.
function directLink(b, plan, time, party) {
  const date = plan.date, t = to24h(time);
  switch (b.platform) {
    case "OpenTable": return { fills: "date, time and party size", url: withParams(b.url, { covers: party, dateTime: `${date}T${t}` }) };
    case "Resy": return { fills: "date and party size, then shows the open times", url: withParams(b.url, { date, seats: party }) };
    case "SevenRooms": return { fills: "date, time and party size",
      url: withParams(b.url, { default_date: date, default_party_size: party, default_time: t }) };
    case "Tock": return { fills: "date, time and party size", url: withParams(b.url.replace(/\/$/, "") + "/search", { date, size: party, time: t }) };
  }
  return { fills: "opens their booking page", url: b.url };
}

// How this venue takes bookings: what the pick card says, and what the reserve screen offers.
// Only ways that actually work for this venue; no blind searches on platforms it isn't on.
function bookingPlan(r, plan, time, party) {
  const b = r.booking;
  if (!b) return { status: "checking", label: "Checking how to book…", links: [] };
  const phone = b.phone ? { platform: "Phone", title: `Call ${b.phone}`, fills: "the restaurant takes it from there",
                            url: "tel:" + b.phone.replace(/[^\d+]/g, "") } : null;
  const site = b.website ? { platform: "Website", title: "Their website", fills: "for anything not listed here", url: b.website } : null;
  if (b.platform)
    return { status: "online", platform: b.platform, label: `Books on ${b.platform}`,
             links: [{ platform: b.platform, title: `Book on ${b.platform}`, ...directLink(b, plan, time, party) }, phone].filter(Boolean) };
  if (b.reservable && r.mapsUrl)
    return { status: "google", platform: "Google", label: "Reserve through Google",
             links: [{ platform: "Google", title: "Reserve on Google", fills: "Google lists it as taking reservations", url: r.mapsUrl }, phone].filter(Boolean) };
  if (b.reservable === false)
    return { status: "walkin", platform: "Walk-in", label: "Walk-in only", links: [phone].filter(Boolean) };
  return { status: "call", platform: "Phone", label: phone ? "Call to book" : "No online booking found", links: [phone, site].filter(Boolean) };
}

function viaText(r) {
  const bp = bookingPlan(r, state.plan, r.openSlot, 2);
  return { checking: "Checking…", online: `You, on ${bp.platform}`, google: "You, through Google",
           walkin: "No booking needed: walk in", call: "You, by phone" }[bp.status];
}

async function loadBooking(recs) {
  // Runs after the picks are on screen, so it never slows them down.
  try {
    const res = await api("/api/booking", { ids: recs.map(r => r.id) });
    for (const r of recs) r.booking = res.booking[r.id] || { platform: null, reservable: r.reservable };
  } catch (e) {
    for (const r of recs) r.booking = { platform: null, reservable: r.reservable };
  }
  if (["results", "confirm", "reserve"].includes(state.screen)) render();
}

function icsFor(c, plan) {
  const [h, m] = to24h(c.time).split(":").map(Number);
  const [y, mo, d] = plan.date.split("-").map(Number);
  const stamp = dt => dt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const start = new Date(y, mo - 1, d, h, m), end = new Date(start.getTime() + 2 * 3600 * 1000);
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Date Night//EN", "BEGIN:VEVENT",
    `UID:${Date.now()}@date-night`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:Date night: ${c.venue}`, `DESCRIPTION:Party of ${c.partySize}${c.platformNote ? " · " + c.platformNote : ""}`,
    "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
}

// ---------- booking terms & verification ----------
const makeTerms = r => ({ venue: r.name, date: fmtDate(state.plan.date), time: r.openSlot, partySize: 2, deposit: S.booking.deposit });
const diffFields = (x, y) => TERM_FIELDS.map(([k]) => k).filter(k => String(x[k]) !== String(y[k]));
function termsTable(left, right, leftLabel, rightLabel, { markBad = false } = {}) {
  const diff = diffFields(left, right);
  return `<table class="terms">
    <tr><th></th><th>${leftLabel}</th><th>${rightLabel}</th>${markBad ? "<th></th>" : ""}</tr>
    ${TERM_FIELDS.map(([k, label]) => {
      const off = diff.includes(k);
      return `<tr class="${off ? (markBad ? "bad" : "changed") : ""}">
        <td class="k">${label}</td><td>${esc(left[k])}</td><td>${esc(right[k])}</td>
        ${markBad ? `<td class="mark">${off ? "✗" : "✓"}</td>` : ""}</tr>`;
    }).join("")}</table>`;
}

// ---------- review verdict (Scenario 1) ----------
function verdictOf(rv) {
  if (!rv.a || !rv.b) return null;
  if (rv.a === "yes" && rv.b === "yes") return "joint_yes";
  if (rv.a === "no" && rv.b === "no") return "joint_no";
  return "split";
}
function adjustmentFor(verdict, rv, venue) {
  if (verdict === "joint_yes") return fill(F1.jointYesLine, { venue });
  if (verdict === "joint_no") return fill(F1.jointNoLine, { venue });
  if (verdict === "missing") return F1.missingLine;
  const who = rv.a === "no" ? A : B;
  const reason = rv.a === "no" ? rv.reasonA : rv.reasonB;
  return fill(F1.adjustments[reason] || F1.adjustments.none, { who, venue });
}
function verdictCard(verdict, rv, venue) {
  if (verdict === "split") {
    const yes = rv.a === "yes" ? A : B, no = rv.a === "no" ? A : B;
    const reason = (rv.a === "no" ? rv.reasonA : rv.reasonB);
    return `<div class="verdict split">
      <div class="badge wild">⚠ ${F1.verdictLabels.split}</div>
      <p>${esc(fill(F1.splitLine, { yes, no, venue, reason: reason ? reason.toLowerCase() : F1.noReasonText }))}</p>
      <p class="adj">${esc(adjustmentFor(verdict, rv, venue))}</p></div>`;
  }
  return `<div class="verdict ${verdict}">
    <div class="badge">${F1.verdictLabels[verdict]}</div>
    <p class="adj">${esc(adjustmentFor(verdict, rv, venue))}</p></div>`;
}

// ---------- backend ----------
const live = () => MODE.real && !state.local;

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${path} failed (${res.status})`);
  for (const c of data.ai_calls || []) {         // show each AI call and agent step in the on-screen log
    if (c.kind === "agent_step") {
      const r = c.returned;
      const brief = c.tool === "google_places_search" && r ? { ...r, venues: r.venues.map(v => v.name) } : r;
      log(`step · ${c.tool}`, { sent: c.sent, returned: brief, error: c.error }, c.error ? "alert" : "ai", false);
    } else {
      log(`ai_call · ${c.step}`, { latency_ms: c.latency_ms, tokens: c.usage,
        confidence: c.confidence, error: c.error, output: c.output,
        instructions: c.instructions ? `${c.prompt_file} (${c.instructions.length} chars, full text in logs/ai_log.jsonl)` : undefined },
        c.error ? "alert" : "ai", false);
    }
  }
  return data;
}

const TYPE_EMOJI = [["cocktail", "🍸"], ["bar", "🍷"], ["jazz", "🎷"], ["music", "🎸"], ["taco", "🌮"], ["mexican", "🌮"],
  ["steak", "🥩"], ["diner", "🍔"], ["mediterranean", "🫒"], ["scandinavian", "🐟"], ["pub", "🍺"]];
const emojiFor = type => (TYPE_EMOJI.find(([k]) => type.toLowerCase().includes(k)) || [0, "🍽️"])[1];

// ---------- data log (stands in for a database) ----------
function log(event, data = {}, kind = "user", send = true) {
  if (send && MODE.real) {                       // same events go to logs/ai_log.jsonl
    fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, data: { ...data, kind, local: state.local } }) }).catch(() => {});
  }
  const list = document.getElementById("log-list");
  const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const div = document.createElement("div");
  div.className = "entry " + kind;
  div.innerHTML = `<span class="t">${t}</span> <span class="ev">${esc(event)}</span><pre>${esc(JSON.stringify(data, null, 1))}</pre>`;
  list.prepend(div);
  const m = state.metrics;
  document.getElementById("m-selected").textContent = m.selected;
  document.getElementById("m-booked").textContent = m.booked;
  document.getElementById("m-fail").textContent = m.fails;
  document.getElementById("m-return").textContent = m.reviews ? Math.round((100 * m.returns) / m.reviews) + "%" : "–";
}

// ---------- AI CALL: build couple memory from onboarding ratings ----------
function buildMemory(ratings) {
  const mem = { lovedByBoth: [], lovedByOne: [], dislikedByBoth: [] };
  for (const [id, r] of Object.entries(ratings)) {
    if (r.a === "heart" && r.b === "heart") mem.lovedByBoth.push(id);
    else if (r.a === "heart" || r.b === "heart") mem.lovedByOne.push(id);
    if (r.a === "hate" && r.b === "hate") mem.dislikedByBoth.push(id);
  }
  return mem;
}

// ---------- AI CALL: recommender (simple rules standing in for P(return)) ----------
function recommend(plan, mem, exclude) {
  const sc = S.scoring;
  const pool = S.candidates.filter(c =>
    !exclude.includes(c.id) &&
    plan.budgets.includes(c.price) &&                       // hard constraint: budget
    !(plan.vegetarian && c.vegetarian === false));          // hard constraint: diet

  const scored = pool.map(c => {
    let score = c.base + sc.perVibeMatch * c.vibes.filter(v => plan.vibes.includes(v)).length;
    const both = c.similarTo.find(id => mem.lovedByBoth.includes(id));
    const one = c.similarTo.find(id => mem.lovedByOne.includes(id));
    if (both) score += sc.lovedByBoth; else if (one) score += sc.lovedByOne;
    if (c.similarTo.some(id => mem.dislikedByBoth.includes(id))) score += sc.dislikedByBoth;
    const loved = both || one;
    return {
      ...c,
      percent: Math.max(sc.minPercent, Math.min(sc.maxPercent, score)),
      why: loved ? fill(c.reason, { loved: venueName(loved) }) : c.reasonFallback,
      openSlot: shiftTime(plan.time, c.slotOffsetMin),
      showFlag: c.vegetarian === "limited" && plan.vegetarian,
    };
  });
  scored.sort((x, y) => y.percent - x.percent);
  return scored.slice(0, 3).map((r, i) => ({ ...r, badge: i < 2 ? "best" : "wild" }));
}

// ---------- screens ----------
const screens = {
  welcome() {
    return `
      <div class="door">
        <h1 class="door-title">Date <span>Night</span></h1>
        <p class="sub door-sub">Date nights you'll both love. We learn your tastes, find the place, and book it.</p>
        <button class="btn" data-act="goSignup">Create your couple account</button>
        <button class="btn secondary" data-act="goLogin">Log in</button>
        <p class="hint">Just looking? <button class="linkish" data-act="tryDemo">Try the demo with Maya and Sam</button></p>
      </div>`;
  },

  signup() {
    const a = state.auth;
    return `
      <form class="door" data-form="doSignup" novalidate>
        <span class="step-tag">New couple</span>
        <h1>Create your couple account</h1>
        <p class="sub">One login for the two of you. Use it on either phone.</p>
        <div class="row2">
          <div><label class="f" for="f-name-a">Your first name</label><input id="f-name-a" data-auth="name_a" autocomplete="given-name" value="${esc(a.name_a)}" placeholder="Jordan"></div>
          <div><label class="f" for="f-name-b">Your partner's first name</label><input id="f-name-b" data-auth="name_b" value="${esc(a.name_b)}" placeholder="Priya"></div>
        </div>
        <label class="f" for="f-user">Couple username</label>
        <input id="f-user" data-auth="username" autocomplete="username" autocapitalize="none" value="${esc(a.username)}" placeholder="jordan-and-priya">
        <label class="f" for="f-pass">Shared password</label>
        <input id="f-pass" type="password" data-auth="password" autocomplete="new-password" value="${esc(a.password)}" placeholder="At least 6 characters">
        ${state.authError ? `<p class="form-error" role="alert">${esc(state.authError)}</p>` : ""}
        <div style="height:16px"></div>
        <button class="btn" type="submit">Create account</button>
        <p class="hint">Already have an account? <button type="button" class="linkish" data-act="goLogin">Log in</button></p>
      </form>`;
  },

  login() {
    const a = state.auth;
    return `
      <form class="door" data-form="doLogin" novalidate>
        <h1>Welcome back</h1>
        <p class="sub">Log in with your couple username.</p>
        <label class="f" for="f-user">Couple username</label>
        <input id="f-user" data-auth="username" autocomplete="username" autocapitalize="none" value="${esc(a.username)}" placeholder="jordan-and-priya">
        <label class="f" for="f-pass">Shared password</label>
        <input id="f-pass" type="password" data-auth="password" autocomplete="current-password" value="${esc(a.password)}">
        ${state.authError ? `<p class="form-error" role="alert">${esc(state.authError)}</p>` : ""}
        <div style="height:16px"></div>
        <button class="btn" type="submit">Log in</button>
        <p class="hint">New here? <button type="button" class="linkish" data-act="goSignup">Create an account</button> · <button type="button" class="linkish" data-act="tryDemo">Try the demo</button></p>
      </form>`;
  },

  basics() {
    const o = S.planOptions, bs = state.basics;
    const col = (who, name) => {
      const b = bs[who];
      const chips = (key, opts) => `<div class="chips">${opts.map(x =>
        `<button class="chip ${b[key].includes(x) ? "on" : ""}" data-act="basic" data-who="${who}" data-key="${key}" data-val="${x}">${x}</button>`).join("")}</div>`;
      return `<div class="basics-col">
        <h3 class="who ${who}">${esc(name)}</h3>
        <label class="f">Food needs</label>${chips("dietary", o.dietary)}
        <label class="f">Never, please</label>${chips("never", o.never)}
        <label class="f" for="vibe-${who}">Vibe</label>
        <input type="range" id="vibe-${who}" min="0" max="10" step="1" value="${b.vibe}" data-vibe="${who}">
        <div class="vibe-scale"><span>Cozy, quiet</span><span>Loud, lively</span></div>
      </div>`;
    };
    return `
      <span class="step-tag">Setup · 1 of 2</span>
      <h1>A few basics, side by side</h1>
      <p class="sub">${esc(A)} and ${esc(B)}, each answer for yourself. Skip anything that doesn't apply.</p>
      <div class="basics">${col("a", A)}${col("b", B)}</div>
      <div style="height:18px"></div>
      <button class="btn" data-act="toRatings">Next: rate some spots</button>`;
  },

  onboarding() {
    const vs = state.venues;
    const done = vs.filter(v => state.ratings[v.id].a && state.ratings[v.id].b).length;
    const rateBtns = (id, who) => {
      const r = state.ratings[id][who];
      return `<div class="rate-btns">
        <button class="rb heart ${who} ${r === "heart" ? "on" : ""}" data-act="rate" data-id="${id}" data-who="${who}" data-val="heart" aria-label="heart">♥</button>
        <button class="rb hate ${r === "hate" ? "on" : ""}" data-act="rate" data-id="${id}" data-who="${who}" data-val="hate" aria-label="hate">✕</button>
        <button class="rb skip ${r === "skip" ? "on" : ""}" data-act="rate" data-id="${id}" data-who="${who}" data-val="skip">Not been</button>
      </div>`;
    };
    return `
      <span class="step-tag">${live() ? "Setup · 2 of 2" : "Step 1 · Onboarding · first time only"}</span>
      <h1>Rate spots you know</h1>
      <p class="sub">${A} and ${B}, each tap ♥ or ✕ for places you've been, or "Not been" if you haven't. This is our starting point.</p>
      <div class="progress"><div style="width:${(100 * done) / vs.length}%"></div></div>
      <div class="venues">${vs.map(v => `
        <div class="venue-row ${state.ratings[v.id].a && state.ratings[v.id].b ? "done" : ""}">
          <div class="venue-head"><div class="emoji">${v.emoji}</div>
            <div><div class="vname">${esc(v.name)}</div><div class="vmeta">${esc(v.type)} · ${esc(v.hood)}</div></div></div>
          <div class="rate-line"><span class="who a">${A}</span>${rateBtns(v.id, "a")}</div>
          <div class="rate-line"><span class="who b">${B}</span>${rateBtns(v.id, "b")}</div>
        </div>`).join("")}</div>
      <button class="btn" data-act="finishOnboarding" ${done < vs.length ? "disabled" : ""}>Continue</button>
      <p class="hint">${done} of ${vs.length} answered by both</p>`;
  },

  plan() {
    const p = state.plan, o = S.planOptions;
    const chips = (key, opts) => `<div class="chips">${opts.map(x =>
      `<button class="chip ${(p[key] || []).includes(x) ? "on" : ""}" data-act="chip" data-key="${key}" data-val="${x}">${x}</button>`).join("")}</div>`;
    return `
      ${banner()}
      <span class="step-tag">Step 2 · Planning</span>
      <h1>Plan a date</h1>
      <p class="sub">Tell us the basics. Everything marked <span style="color:var(--a)">*</span> is required.</p>
      <div class="row2">
        <div><label class="f">Day <span class="req">*</span></label><input type="date" data-field="date" value="${p.date}"></div>
        <div><label class="f">Time <span class="req">*</span></label>
          <select data-field="time"><option value="">Pick…</option>${o.times.map(t => `<option ${p.time === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      </div>
      <label class="f">Where <span class="req">*</span></label>
      <select data-field="location"><option value="">Pick a neighborhood…</option>${o.locations.map(l => `<option ${p.location === l ? "selected" : ""}>${l}</option>`).join("")}</select>
      <label class="f">Budget <span class="req">*</span> <span style="text-transform:none;font-weight:500">(pick one or more)</span></label>${chips("budgets", o.budgets)}
      <label class="f">Vibe <span class="req">*</span> <span style="text-transform:none;font-weight:500">(pick one or more)</span></label>${chips("vibes", o.vibes)}
      <label class="f">Craving anything? <span style="text-transform:none;font-weight:500">(optional)</span></label>${chips("cravings", o.cravings || [])}
      <input type="text" id="craving-text" data-field="cravingText" placeholder="Or type it: ramen, a tasting menu, oysters" value="${esc(p.cravingText || "")}" style="margin-top:8px">
      <label class="check"><input type="checkbox" data-field="vegetarian" ${p.vegetarian ? "checked" : ""}> Needs vegetarian options</label>
      <div style="height:18px"></div>
      <button class="btn" id="find-btn" data-act="findDates" ${planReady() ? "" : "disabled"}>Find dates</button>`;
  },

  loading() {
    return `<div class="loading">
      <span class="step-tag">Finding your options…</span>
      <h1>One moment</h1>
      <p class="sub">${esc(state.loadingTitle || "")}</p>
      <div id="lsteps">${state.loadingSteps.map((s, i) =>
        `<div class="lstep" id="ls-${i}"><span class="ic">…</span>${esc(s)}</div>`).join("")}</div>
      <div class="progress" style="margin-top:18px"><div id="lbar" style="width:0%"></div></div></div>`;
  },

  results() {
    const p = state.plan;
    const recs = state.current;
    return `
      <span class="step-tag">Step 3 · Selection</span>
      <h1>${esc(fill(S.recommendationsHeader, { date: fmtDate(p.date) }))}</h1>
      <p class="sub">${p.time} · ${esc(p.location)} · ${p.budgets.join("/")} · ${p.vibes.join(", ")}${p.vegetarian ? " · vegetarian" : ""}${cravingOf(p) ? " · craving " + esc(cravingOf(p)) : ""}</p>
      ${pipelineSummary()}
      ${state.pipeline && state.pipeline.note ? `<div class="flag">ℹ ${esc(state.pipeline.note)}</div>` : ""}
      ${recs.length ? `<div class="recs">` + recs.map((r, i) => `
        <div class="rec">
          <div class="badge ${r.badge}">${r.badge === "best" ? "★ Best fit" : "+ Wildcard"}</div>
          <h3>${esc(r.name)}</h3>
          <div class="meta">${esc(r.type)} · ${r.price} · ${r.rating}★ · ${r.distance}</div>
          ${r.headline ? `<p class="headline">${esc(r.headline)}</p>` : ""}
          <p class="why">${esc(r.why)}</p>
          ${r.showFlag ? `<div class="flag">⚠ ${esc(r.flag)}</div>` : ""}
          <div class="pills"><span class="pill slot">${r.openSlot} open</span>${r.percent != null ? `<span class="pill">~${r.percent}% you'd both go back</span>` : ""}${
            live() ? `<span class="pill book ${bookingPlan(r, p, r.openSlot, 2).status}">${esc(bookingPlan(r, p, r.openSlot, 2).label)}</span>` : ""}</div>
          <button class="btn ${i ? "secondary" : ""}" data-act="select" data-i="${i}">Choose ${esc(r.name)}</button>
        </div>`).join("") + `</div>` : `<div class="flag">${esc(S.noMoreMessage)}</div>`}
      <div class="more-box">
        <label class="f" style="margin-top:0">None of these? (optional note)</label>
        <input type="text" id="note" placeholder="e.g. somewhere quieter" value="${esc(state.note)}">
        <div style="height:10px"></div>
        <button class="btn secondary" data-act="generateMore">↻ Generate more</button>
        <button class="btn secondary" data-act="goPlan">Change plan</button>
      </div>`;
  },

  confirm() {
    const r = state.selected, t = makeTerms(r);
    return `
      <span class="step-tag">Step 4 · Confirmation</span>
      <h1>Book ${esc(r.name)}?</h1>
      <p class="sub">${live() ? "Check the details. Next we open the booking page with them filled in, and you book with one tap." : esc(fill(S.booking.confirmPrompt, { venue: r.name }))}</p>
      <div class="summary">
        <div class="line"><span class="k" style="font-weight:700;color:var(--ink)">You're approving exactly:</span><span class="v"></span></div>
        ${TERM_FIELDS.map(([k, label]) => `<div class="line"><span class="k">${label}</span><span class="v">${esc(t[k])}</span></div>`).join("")}
        <div class="line"><span class="k">Via</span><span class="v">${live() ? esc(viaText(r)) : esc(S.booking.platform)}</span></div>
      </div>
      <p class="hint" style="margin:-6px 0 14px">${live() ? "If you get a different time or party size, we'll flag it when you tell us what you booked." : "If any of these change, we'll stop and ask you again before booking."}</p>
      <button class="btn" data-act="allow">Allow</button>
      <button class="btn secondary" data-act="deny">Deny</button>`;
  },

  reserve() {
    const r = state.selected, t = state.approved;
    const bp = bookingPlan(r, state.plan, t.time, t.partySize);
    const n = esc(r.name);
    const intro = {
      checking: `Checking where ${n} takes bookings…`,
      online: `${n} takes bookings on ${bp.platform}. This opens their page with your details filled in.`,
      google: `Google lists ${n} as taking reservations. We couldn't find their own booking page, so book through Google${bp.links.length > 1 ? " or call" : ""}.`,
      walkin: `Google lists ${n} as not taking reservations, so there's nothing to book: just show up.${bp.links.length ? " Calling ahead can't hurt." : ""}`,
      call: `We couldn't find online booking for ${n}.${bp.links.length ? " Call them, or check their website." : ""}`,
    }[bp.status];
    const walkin = bp.status === "walkin";
    return `
      <span class="step-tag">Step 4 · Book it</span>
      <h1>${walkin ? "Walk in at" : "Reserve"} ${n}</h1>
      <p class="sub">${esc(t.date)} · ${esc(t.time)} · party of ${t.partySize}. ${intro}</p>
      <div class="handoff">${bp.links.map(l => `
        <a class="handoff-link" href="${esc(l.url)}" ${l.platform === "Phone" ? "" : `target="_blank" rel="noopener"`} data-handoff="${l.platform}">
          <b>${esc(l.title)}${l.platform === "Phone" ? "" : " ↗"}</b>
          <span>${esc(l.fills)}</span></a>`).join("")}</div>
      ${bp.status === "online" ? `<p class="hint" style="text-align:left">We can see where they take bookings, not whether ${esc(t.time)} is still free. ${bp.platform} shows that.</p>` : ""}
      <div class="summary" style="margin-top:18px">
        <div class="line"><span class="k" style="font-weight:700;color:var(--ink)">${walkin ? "Going for it?" : "Done booking?"}</span><span class="v"></span></div>
      </div>
      <button class="btn" data-act="gotIt" ${bp.status === "checking" ? "disabled" : ""}>${walkin ? "Yes, we'll walk in" : "Yes, it's booked"}</button>
      <button class="btn secondary" data-act="couldntBook">${walkin ? "Pick somewhere else" : "Couldn't get it"}</button>`;
  },

  gotIt() {
    const t = state.approved, g = state.got;
    const times = S.planOptions.times.includes(t.time) ? S.planOptions.times : [t.time, ...S.planOptions.times];
    return `
      <form data-form="saveRealBooking" novalidate>
        <span class="step-tag">Step 4 · Book it</span>
        <h1>What did you book?</h1>
        <p class="sub">We'll check it against what you approved. Change anything that came out different.</p>
        <div class="row2">
          <div><label class="f" for="got-platform">Booked on</label>
            <select id="got-platform" data-got="platform">${["OpenTable", "Resy", "SevenRooms", "Tock", "Google", "Phone", "Walk-in", "Other"].map(p =>
              `<option ${g.platform === p ? "selected" : ""}>${p}</option>`).join("")}</select></div>
          <div><label class="f" for="got-time">Time</label>
            <select id="got-time" data-got="time">${times.map(x => `<option ${g.time === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
        </div>
        <div class="row2">
          <div><label class="f" for="got-party">Party size</label><input id="got-party" type="number" min="1" max="12" data-got="partySize" value="${g.partySize}"></div>
          <div><label class="f" for="got-deposit">Deposit</label><input id="got-deposit" data-got="deposit" value="${esc(g.deposit)}"></div>
        </div>
        <label class="f" for="got-conf">Confirmation number <span style="text-transform:none;font-weight:500">(optional)</span></label>
        <input id="got-conf" data-got="confirmation" value="${esc(g.confirmation)}" placeholder="From the booking email or app">
        <div style="height:16px"></div>
        <button class="btn" type="submit">Save booking</button>
        <button class="btn secondary" type="button" data-act="backToReserve">Back</button>
      </form>`;
  },

  couldnt() {
    return `
      <span class="step-tag">Step 4 · Book it</span>
      <div class="warn-box">Nothing was booked at ${esc(state.selected.name)}.</div>
      <h1>What would you like to do?</h1>
      <p class="sub">Picks fill up. Try another of tonight's options, or start a new plan with a different time.</p>
      <button class="btn" data-act="backToPicks">Back to the other picks</button>
      <button class="btn secondary" data-act="goPlan">Change the plan</button>`;
  },

  booking() {
    return `<div class="loading">
      <span class="step-tag">Booking agent</span>
      <h1>Booking ${esc(state.selected.name)}</h1>
      <p class="sub">The agent is reserving your table.</p>
      <div id="lsteps">${state.loadingSteps.map((s, i) =>
        `<div class="lstep" id="ls-${i}"><span class="ic">…</span>${esc(s)}</div>`).join("")}</div>
      <div class="progress" style="margin-top:18px"><div id="lbar" style="width:0%"></div></div></div>`;
  },

  // Scenario 2: the approved slot is gone — the agent stops and asks.
  mismatch() {
    const old = state.approved, found = state.found;
    return `
      <span class="step-tag">Step 4 · Booking stopped</span>
      <div class="warn-box">⚠ ${esc(fill(F2.warning, { old: old.time, new: found.time }))}</div>
      <h1>Book the new time instead?</h1>
      <p class="sub">Highlighted rows differ from what you approved. Approving below is a new approval.</p>
      ${termsTable(old, found, "You approved", "Now available")}
      <button class="btn" data-act="approveNew">Approve ${esc(found.time)} and book</button>
      <button class="btn secondary" data-act="backToPicks">Back to other picks</button>
      <button class="btn secondary" data-act="cancelBooking">Cancel</button>`;
  },

  booked() {
    const r = state.selected, b = state.booking, c = b.confirmed;
    const bad = b.mismatches.length > 0;
    return `
      <div class="big-icon">${bad ? "⚠️" : "🎉"}</div>
      <h1 class="center">${bad ? "Booked — but check this" : "You're booked!"}</h1>
      <p class="sub center">${esc(bad ? (b.real ? "What you booked differs from what you approved. Check the highlighted rows before you go." : F2.mismatchWarning) : (b.real ? "Checked against what you approved." : S.booking.successMessage))}</p>
      <div class="summary">
        <div class="line"><span class="k">${esc(c.venue)}</span><span class="v">${esc(c.date)}</span></div>
        <div class="line"><span class="k">${esc(c.time)} · party of ${c.partySize}</span><span class="v">${b.real ? esc(b.platform) : "#" + b.id}</span></div>
      </div>
      <label class="f" style="margin-top:0">Booking check</label>
      ${termsTable(b.approved, c, "Approved", "Confirmed", { markBad: true })}
      <div style="height:14px"></div>
      ${b.real ? `
      <p class="hint" style="text-align:left">Booked by you on ${esc(b.platform)}${b.confirmation ? " · confirmation " + esc(b.confirmation) : ""}.</p>
      <button class="btn secondary" data-act="addToCalendar">Add to calendar</button>` : `
      <button class="btn secondary" data-act="toggleExternal">${state.showExternal ? "Hide" : "View"} booking confirmation ↗</button>`}
      ${!b.real && state.showExternal ? `
        <div class="ext"><div class="bar">${esc(S.booking.platform)} — Reservation confirmed</div>
          <div class="body"><b>${esc(c.venue)}</b><br>${esc(c.date)} at ${esc(c.time)}<br>Party of ${c.partySize} · Deposit: ${esc(c.deposit)} · Confirmation #${b.id}<br>
          <span class="meta">Simulated external page. No real reservation was made.</span></div></div>` : ""}
      <button class="btn secondary" data-act="share">Copy plan to share</button>
      <div style="height:22px"></div>
      <p class="hint" style="margin-bottom:8px">Demo shortcut: skip ahead to after the date</p>
      <button class="btn purple" data-act="goReview">Fast-forward: after the date →</button>`;
  },

  review() {
    const r = state.selected, rv = state.review;
    const yn = who => `<div class="yn">
      <button class="${rv[who] === "yes" ? "on " + who : ""}" data-act="review" data-who="${who}" data-val="yes">Yes</button>
      <button class="${rv[who] === "no" ? "on " + who : ""}" data-act="review" data-who="${who}" data-val="no">No</button></div>`;
    const reasons = who => {
      if (rv[who] !== "no") return "";
      const key = who === "a" ? "reasonA" : "reasonB";
      return `<div class="reasons"><span class="meta">Why not? (one tap)</span><div class="chips">${F1.reasons.map(x =>
        `<button class="chip ${rv[key] === x ? "on" : ""}" data-act="reason" data-who="${who}" data-val="${x}">${x}</button>`).join("")}</div></div>`;
    };
    const v = verdictOf(rv);
    return `
      <span class="step-tag">Step 5 · Post-visit review</span>
      <h1>How was ${esc(r.name)}?</h1>
      <p class="sub">${esc(fill(S.review.question, { venue: r.name }))} Answer separately — it's fine to disagree.</p>
      <div class="review-q" style="color:var(--a)">${A}: would you go back?</div>${yn("a")}${reasons("a")}
      <div class="review-q" style="color:var(--b)">${B}: would you go back?</div>${yn("b")}${reasons("b")}
      ${v === "split" ? `<div style="height:16px"></div>${verdictCard(v, rv, r.name)}` : ""}
      <div style="height:22px"></div>
      <button class="btn" data-act="saveReview" ${v ? "" : "disabled"}>Save</button>
      <button class="btn secondary" data-act="skipReview">Skip review</button>
      <p class="hint">Skipping saves this as “missing”, not as a “no”.</p>`;
  },

  profile() {
    const md = state.profileMd || "";
    if (state.profileEditing) {
      return `
        <span class="step-tag">Your profile</span>
        <h1>Fix what we know</h1>
        <p class="sub">Edit anything that's wrong. Keep the section headings so the app can read it.</p>
        <textarea id="profile-edit" rows="18" style="font:13px/1.5 ui-monospace, Menlo, monospace">${esc(md)}</textarea>
        ${state.profileError ? `<p class="hint" style="color:var(--bad);text-align:left">${esc(state.profileError)}</p>` : ""}
        <div style="height:12px"></div>
        <button class="btn" data-act="saveProfile">Save</button>
        <button class="btn secondary" data-act="cancelProfileEdit">Cancel</button>`;
    }
    const sections = md.split(/\n(?=## )/).filter(s => s.trim().startsWith("## ")).map(s => {
      const [head, ...rest] = s.trim().split("\n");
      const items = rest.filter(l => l.trim().startsWith("- ")).map(l => {
        const t = l.trim().slice(2), m = t.match(/^(.*?)\s*\[(.*)\]\s*$/);
        return m ? `<li>${esc(m[1])} <span class="meta">${esc(m[2])}</span></li>` : `<li>${esc(t)}</li>`;
      });
      return `<div class="profile-sec"><h3>${esc(head.replace(/^##\s*/, "").replace(/\s*\(.*\)\s*$/, ""))}</h3>
        ${items.length ? `<ul>${items.join("")}</ul>` : `<p class="meta">Nothing yet.</p>`}</div>`;
    });
    return `
      ${banner()}
      <span class="step-tag">Your profile</span>
      <h1>What we know about ${esc(A)} &amp; ${esc(B)}</h1>
      <p class="sub">Built from your ratings and every date you review. The brackets show the evidence.</p>
      ${sections.length ? sections.join("") : `<p class="flag">No profile yet. Rate some spots to start one.</p>`}
      <div style="height:12px"></div>
      <button class="btn" data-act="goPlan">Plan a date</button>
      <button class="btn secondary" data-act="editProfile">Fix something</button>`;
  },

  thanks() {
    const r = state.selected, v = state.verdict;
    const icon = { joint_yes: "💞", joint_no: "📝", split: "⚖️", missing: "⏭️" }[v];
    return `
      <div class="big-icon">${icon}</div>
      <h1 class="center">${v === "missing" ? "Review skipped" : "Thanks!"}</h1>
      <p class="sub center">${esc(v === "missing" ? "No problem." : S.review.thanks)}</p>
      <label class="f" style="margin-top:0">What we learned</label>
      ${verdictCard(v, state.review, r.name)}
      ${state.learned.length ? `<div class="learned"><b>🧠 Your updated profile</b>${state.learned.map(l => `<div>${esc(l)}</div>`).join("")}</div>` : ""}
      ${state.error ? `<p class="hint">${esc(state.error)}</p>` : ""}
      <div style="height:18px"></div>
      <button class="btn" data-act="goPlan">Plan the next date</button>`;
  },
};

function banner() {
  if (!state.banner) return "";
  const { title, lines = [] } = state.banner;
  return `<div class="learned" style="margin-bottom:18px"><b>${esc(title)}</b>${lines.map(l => `<div>${esc(l)}</div>`).join("")}</div>`;
}

function pipelineSummary() {
  const p = state.pipeline;
  if (!p) return "";
  const by = p.source === "ai" ? "How we picked these" : "Picked with our backup rules";
  const dropped = Object.entries(p.dropped || {}).map(([r, n]) => `${n} ${r}`).join(", ");
  const secs = p.timing && p.timing.total != null ? ` · ${Math.round(p.timing.total)}s` : "";
  return `<details class="how"><summary>${esc(by)} · ${p.found} found → ${p.kept} passed your rules → ${state.current.length} picked${secs}</summary>
    ${p.timing ? `<div><b>Time:</b> writing searches ${p.timing.write_searches}s · searching and filtering ${p.timing.search_and_filter}s · picking ${p.timing.pick_3}s</div>` : ""}
    <div><b>Searches we ran:</b> ${p.queries.map(q => `“${esc(q)}”`).join(" · ")}</div>
    ${dropped ? `<div><b>Filtered out:</b> ${esc(dropped)}</div>` : ""}
    <div><b>Venues from:</b> ${p.places === "google" ? "Google Places (live)" : "sample Chicago venues"}</div>
    ${(p.notes || []).map(n => `<div class="hint" style="text-align:left">${esc(n)}</div>`).join("")}</details>`;
}

// A loading screen that ticks through steps while a backend call runs.
async function whileLoading(steps, title, promise) {
  state.loadingSteps = steps; state.loadingTitle = title;
  state.screen = "loading"; render();
  let i = 0, done = false;
  const tick = () => {
    const el = document.getElementById("ls-" + i);
    if (el) { el.classList.add("done"); el.querySelector(".ic").textContent = "✓"; }
    const bar = document.getElementById("lbar");
    if (bar) bar.style.width = (100 * (i + 1)) / steps.length + "%";
    i++;
  };
  const timer = setInterval(() => { if (!done && i < steps.length - 1) tick(); }, 1800);
  try { return await promise; }
  finally { done = true; clearInterval(timer); while (i < steps.length) tick(); await sleep(250); }
}

// Where a couple lands after signing up, logging in, or opening the demo.
function applyMe(me, banner) {
  state.me = me; state.authError = null; state.local = false;
  [A, B] = me.partners;
  state.plan = { date: "", time: "", location: "", budgets: [], vibes: [], vegetarian: !!me.vegetarian };
  state.basics = { a: { dietary: [], never: [], vibe: 5 }, b: { dietary: [], never: [], vibe: 5 } };
  state.selected = null; state.booking = null; state.pipeline = null; state.learned = []; state.error = null;
  lastScreen = null;
  if (!me.onboarded) { state.banner = null; return go("basics"); }
  const due = me.pending_review;
  if (due) {
    state.selected = { id: due.place_id, name: due.name, kind: due.kind };
    state.booking = { serverId: due.booking_id, when: due.when };
    state.review = { a: null, b: null, reasonA: null, reasonB: null };
    state.banner = null;
    return go("review");
  }
  state.banner = banner || { title: `Welcome back, ${A} & ${B}`, lines: ["Plan your next date below."] };
  go("plan");
}

// The logo: signed out → front door; mid-setup → setup; otherwise → Plan a date, keeping the form as filled in.
function goHome() {
  state.local = false; state.banner = null; state.profileEditing = false;
  if (MODE.real && !state.me) return go("welcome");
  if (MODE.real && !state.me.onboarded) return go(state.screen === "onboarding" ? "onboarding" : "basics");
  if (!MODE.real && !state.memory) return go("onboarding");
  log("home", {});
  go("plan");
}

async function signOut() {
  try { await api("/api/logout", {}); } catch (e) {}
  state.me = null; state.banner = null; state.auth = { name_a: "", name_b: "", username: "", password: "" };
  [A, B] = [S.couple.a, S.couple.b];
  log("logged_out", {});
  go("welcome");
}

function cravingOf(p) {
  return [...(p.cravings || []), (p.cravingText || "").trim()].filter(Boolean).join(", ");
}

function planReady() {
  const p = state.plan;
  return p.date && p.time && p.location && p.budgets.length && p.vibes.length;
}

function render() {
  const who = document.getElementById("couple");   // "Signed in as" always shows the current couple
  if (who) who.innerHTML = !MODE.real
    ? `Planning for <b class="a">${esc(A)}</b> &amp; <b class="b">${esc(B)}</b>`
    : !state.me ? ""
    : `<button type="button" class="couple-link" data-profile>Planning for <b class="a">${esc(A)}</b> &amp; <b class="b">${esc(B)}</b> <span aria-hidden="true">›</span></button>
       <button type="button" class="couple-link" data-signout>Sign out</button>`;
  document.body.dataset.auth = !MODE.real || state.me ? "in" : "out";
  // Redraws happen on every click (a rating, a chip). Only jump to the top when the screen itself changes,
  // so the page stays where the user is while they fill something in.
  const newScreen = state.screen !== lastScreen;
  lastScreen = state.screen;
  screenEl.innerHTML = screens[state.screen]();
  if (newScreen) screenEl.scrollTop = 0;
  if (window.onScreenChange) window.onScreenChange(state.screen, newScreen);   // step bar in index.html
}
let lastScreen = null;
function go(screen) { state.screen = screen; render(); }

async function runSteps(steps, title, stepMs) {
  state.loadingSteps = steps; state.loadingTitle = title;
  render();
  for (let i = 0; i < steps.length; i++) {
    await sleep(stepMs);
    const el = document.getElementById("ls-" + i);
    if (el) { el.classList.add("done"); el.querySelector(".ic").textContent = "✓"; }
    const bar = document.getElementById("lbar");
    if (bar) bar.style.width = (100 * (i + 1)) / steps.length + "%";
  }
  await sleep(300);
}

async function showRecommendations(reason) {
  if (!live()) {
    state.screen = "loading";
    await runSteps(S.loadingSteps, reason, 550);
    state.current = recommend(state.plan, state.memory, state.shown);   // simulated
    state.pipeline = null;
  } else {
    try {
      const res = await whileLoading(
        ["Writing searches from what you two love", "Searching for venues", "Filtering against your rules", "Picking 3"],
        reason, api("/api/recommend", { ...state.plan, craving: cravingOf(state.plan), note: state.note, exclude: state.shown }));
      state.pipeline = res;
      state.current = res.picks.map(p => ({
        id: p.id, name: p.name, type: p.type, price: p.price, rating: p.rating ?? "?", distance: (p.miles != null ? p.miles + " mi · " : "") + p.address,
        headline: p.headline, why: p.why, percent: p.return_chance, openSlot: state.plan.time,
        showFlag: !!p.heads_up, flag: p.heads_up, badge: p.kind === "wildcard" ? "wild" : "best", kind: p.kind,
        mapsUrl: p.maps_url, reservable: p.reservable,
      }));
    } catch (e) {
      state.banner = { title: "Couldn't reach the backend", lines: [String(e.message || e)] };
      log("recommend_failed", { error: String(e) }, "alert");
      return go("plan");
    }
  }
  state.shown.push(...state.current.map(r => r.id));
  log("recommendations_shown", {
    source: state.pipeline ? state.pipeline.source : "simulated",
    picks: state.current.map(r => ({ id: r.id, name: r.name, percent: r.percent, slot: r.openSlot })),
  }, "ai");
  go("results");
  if (live()) loadBooking(state.current);
}

// ---------- actions ----------
const actions = {
  goSignup() { state.authError = null; go("signup"); },
  goLogin() { state.authError = null; go("login"); },
  async tryDemo() {
    try {
      const res = await api("/api/demo", {});
      applyMe(res.me, { title: "Welcome to the demo, Maya & Sam", lines: ["Five past dates and a written profile. Plan a date to see the memory at work."] });
      log("demo_opened", {}, "alert");
    } catch (e) { state.authError = e.message; render(); }
  },
  async doSignup() {
    const a = state.auth;
    try {
      const res = await api("/api/signup", { username: a.username, password: a.password, name_a: a.name_a, name_b: a.name_b });
      state.auth = { name_a: "", name_b: "", username: "", password: "" };
      log("account_created", { username: res.username });
      applyMe(res);
    } catch (e) { state.authError = e.message; render(); }
  },
  async doLogin() {
    const a = state.auth;
    try {
      const res = await api("/api/login", { username: a.username, password: a.password });
      state.auth = { name_a: "", name_b: "", username: "", password: "" };
      log("logged_in", { username: res.username });
      applyMe(res);
    } catch (e) { state.authError = e.message; state.auth.password = ""; render(); }
  },
  basic(d) {
    const arr = state.basics[d.who][d.key], i = arr.indexOf(d.val);
    i >= 0 ? arr.splice(i, 1) : arr.push(d.val);
    render();
  },
  toRatings() {
    state.ratings = Object.fromEntries(state.venues.map(v => [v.id, { a: null, b: null }]));
    log("basics_done", state.basics);
    go("onboarding");
  },
  rate(d) {
    const r = state.ratings[d.id];
    r[d.who] = r[d.who] === d.val ? null : d.val;
    log("onboarding_rating", { venue: d.id, partner: d.who === "a" ? A : B, rating: r[d.who] });
    render();
  },
  async finishOnboarding() {
    if (!live()) {
      state.memory = buildMemory(state.ratings);                       // simulated
      log("memory_initialized", state.memory, "ai");
      return go("plan");
    }
    try {
      const res = await whileLoading(["Saving your answers", "Writing your first profile"],
        "Building what we know about you two.", api("/api/onboard", { ratings: state.ratings, basics: state.basics }));
      log("memory_initialized", { learned: res.learned, profile: res.profile, error: res.error }, "ai");
      if (state.me) state.me.onboarded = true;
      state.plan.vegetarian = ["a", "b"].some(w => state.basics[w].dietary.some(d => d === "Vegetarian" || d === "Vegan"));
      state.profileMd = res.profile; state.profileEditing = false;
      state.banner = { title: "You're all set. Here's what we learned.", lines: res.learned };
      return go("profile");
    } catch (e) {
      state.banner = { title: "Couldn't save your setup", lines: [String(e.message || e)] };
    }
    go("plan");
  },
  chip(d) {
    const arr = state.plan[d.key] || (state.plan[d.key] = []);
    const i = arr.indexOf(d.val);
    i >= 0 ? arr.splice(i, 1) : arr.push(d.val);
    render();
  },
  findDates() {
    if (!planReady()) return;
    state.shown = []; state.note = ""; state.banner = null;
    log("plan_submitted", { ...state.plan, partySize: 2 });
    showRecommendations("Checking spots against your rules and what you both love.");
  },
  select(d) {
    const r = state.current[+d.i];
    state.selected = r; state.metrics.selected++;
    log("option_selected", { venue: r.id, rank: +d.i + 1, percent: r.percent,
      notChosen: state.current.filter(x => x.id !== r.id).map(x => x.id) });
    if (live()) api("/api/pick", { session_id: state.pipeline.session_id, place_id: r.id, name: r.name, kind: r.kind }).catch(() => {});
    go("confirm");
  },
  generateMore() {
    state.note = document.getElementById("note").value.trim();
    log("generate_more", { implicitlyRejected: state.current.map(r => r.id), note: state.note || null });
    showRecommendations(state.note ? `Looking again, keeping in mind: "${state.note}"` : "Looking again.");
  },
  goPlan() {
    state.plan = { date: "", time: "", location: "", budgets: [], vibes: [], vegetarian: !!(state.me && state.me.vegetarian) };
    state.banner = null;
    state.review = { a: null, b: null, reasonA: null, reasonB: null }; state.showExternal = false;
    state.learned = []; state.error = null;
    go("plan");
  },
  deny() {
    log("booking_denied", { venue: state.selected.id });
    go("results");
  },
  async allow() {
    const r = state.selected;
    state.approved = makeTerms(r);
    log("booking_approved", { approvedTerms: state.approved });
    if (live()) {
      const bp = bookingPlan(r, state.plan, state.approved.time, state.approved.partySize);
      state.got = { platform: bp.platform || "OpenTable", time: state.approved.time, partySize: state.approved.partySize,
                    deposit: state.approved.deposit, confirmation: "" };
      return go("reserve");
    }
    if (state.test.slotGone) {
      // Scenario 2: the agent re-checks the approved slot before booking, finds it gone, and STOPS.
      state.screen = "booking";
      await runSteps(F2.agentStepsSlotGone, "", 600);                  // AI CALL: booking agent
      state.found = { ...state.approved, time: shiftTime(state.approved.time, F2.nearMatchOffsetMin), deposit: F2.nearMatchDeposit };
      state.metrics.fails++;
      log("booking_stopped_slot_mismatch", {
        approvedTerms: state.approved, foundTerms: state.found,
        fieldsDiffered: diffFields(state.approved, state.found), booked: false,
      }, "alert");
      go("mismatch");
      return;
    }
    await bookAndVerify(state.approved, S.booking.agentSteps);
  },
  gotIt() { go("gotIt"); },
  backToReserve() { go("reserve"); },
  couldntBook() {
    state.metrics.fails++;
    log("real_booking_failed", { venue: state.selected.id, approvedTerms: state.approved }, "alert");
    go("couldnt");
  },
  async saveRealBooking() {
    const t = state.approved, g = state.got;
    const confirmed = { ...t, time: g.time, partySize: Number(g.partySize) || t.partySize, deposit: g.deposit || t.deposit,
                        platformNote: g.platform };
    const mismatches = diffFields(t, confirmed);
    state.booking = { id: g.confirmation || "", real: true, platform: g.platform, confirmation: g.confirmation,
                      approved: t, confirmed, mismatches };
    state.showExternal = false;
    state.metrics.booked++;
    log("real_booking_saved", { venue: state.selected.id, platform: g.platform, confirmation: g.confirmation || null,
                                approvedTerms: t, confirmedTerms: confirmed, mismatchedFields: mismatches });
    if (mismatches.length) {
      state.metrics.fails++;
      log("booking_mismatch_flagged", { fields: mismatches.map(k => ({ field: k, approved: t[k], confirmed: confirmed[k] })) }, "alert");
    }
    try {
      const res = await api("/api/book", { session_id: state.pipeline && state.pipeline.session_id, place_id: state.selected.id,
        name: state.selected.name, kind: state.selected.kind, date: state.plan.date, time: confirmed.time,
        party_size: confirmed.partySize, platform: g.platform, confirmation: g.confirmation || null, real: true });
      state.booking.serverId = res.booking_id;
      state.booking.when = `${state.plan.date}T${to24(confirmed.time)}`;
    } catch (e) { log("book_record_failed", { error: String(e) }, "alert"); }
    go("booked");
  },
  addToCalendar() {
    const blob = new Blob([icsFor(state.booking.confirmed, state.plan)], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "date-night.ics";
    document.body.appendChild(a); a.click(); a.remove();
    log("calendar_added", { venue: state.selected.id });
  },
  async approveNew() {
    log("mismatch_decision", { decision: "approve_new_terms", newApprovedTerms: state.found });
    state.approved = state.found;
    state.selected = { ...state.selected, openSlot: state.found.time };
    await bookAndVerify(state.approved, F2.agentStepsRebook);
  },
  backToPicks() {
    log("mismatch_decision", { decision: "back_to_other_picks", booked: false });
    go("results");
  },
  cancelBooking() {
    log("mismatch_decision", { decision: "cancel", booked: false });
    actions.goPlan();
  },
  toggleExternal() {
    state.showExternal = !state.showExternal;
    if (state.showExternal) log("confirmation_opened", { confirmation: state.booking.id });
    render();
  },
  share(_, btn) {
    const c = state.booking.confirmed;
    const text = `Date night: ${c.venue}, ${c.date} at ${c.time} (party of ${c.partySize}). Conf #${state.booking.id}`;
    navigator.clipboard?.writeText(text).catch(() => {});
    btn.textContent = "Copied ✓";
    log("plan_shared", { text });
  },
  editProfile() { state.profileEditing = true; state.profileError = null; render(); },
  cancelProfileEdit() { state.profileEditing = false; render(); },
  async saveProfile() {
    const md = document.getElementById("profile-edit").value;
    try {
      const res = await api("/api/profile", { profile: md });
      state.profileMd = res.profile; state.profileEditing = false;
      log("profile_edited", { chars: md.length });
    } catch (e) {
      state.profileError = "Couldn't save. Keep at least one section and try again.";
    }
    render();
  },
  goReview() { state.review = { a: null, b: null, reasonA: null, reasonB: null }; go("review"); },
  review(d) {
    const rv = state.review, key = d.who === "a" ? "reasonA" : "reasonB";
    const prev = rv[d.who];
    rv[d.who] = d.val;
    if (d.val === "yes") rv[key] = null;
    log(prev ? "review_answer_changed" : "review_answer", { partner: d.who === "a" ? A : B, from: prev, to: d.val });
    render();
  },
  reason(d) {
    const key = d.who === "a" ? "reasonA" : "reasonB";
    const prev = state.review[key];
    state.review[key] = prev === d.val ? null : d.val;
    log(prev ? "review_reason_changed" : "review_reason", { partner: d.who === "a" ? A : B, from: prev, to: state.review[key] });
    render();
  },
  saveReview() {
    const rv = state.review, r = state.selected, v = verdictOf(rv);
    saveVerdict(v, r, rv);
  },
  skipReview() {
    log("review_skipped", { venue: state.selected.id, partialAnswers: { [A]: state.review.a, [B]: state.review.b } });
    saveVerdict("missing", state.selected, state.review);
  },
};

async function saveVerdict(v, r, rv) {
  state.verdict = v; state.learned = []; state.error = null;
  if (v !== "missing") state.metrics.reviews++;          // missing reviews stay out of the denominator
  if (v === "joint_yes") state.metrics.returns++;
  const adjustment = adjustmentFor(v, rv, r.name);
  log("review_saved", {
    venue: r.id,
    answers: { [A]: rv.a, [B]: rv.b },
    reasons: { [A]: rv.reasonA, [B]: rv.reasonB },
    verdictType: v,
    adjustmentForNextTime: adjustment,
  }, v === "split" || v === "missing" ? "alert" : "user");
  // Close the loop with the right label: split stays split, missing is excluded — never a fake "no".
  const label = { joint_yes: 1, joint_no: 0, split: "split", missing: null }[v];
  log("memory_updated", {
    venue: r.id, label,
    perPartner: v === "missing" ? null : { [A]: rv.a === "yes" ? 1 : 0, [B]: rv.b === "yes" ? 1 : 0 },
    usedForTraining: v !== "missing",
  }, "ai");
  if (live() && state.booking && state.booking.serverId) {
    try {
      const res = await whileLoading(v === "missing" ? ["Saving"] : ["Saving your answers", "Updating your profile"],
        "Updating what we know about you two.",
        api("/api/review", { booking_id: state.booking.serverId, place_id: r.id, name: r.name, kind: r.kind,
          when: state.booking.when, verdict: v, answers: { a: rv.a, b: rv.b }, reasons: { a: rv.reasonA, b: rv.reasonB } }));
      state.learned = res.learned || [];
      if (res.error) state.error = "We saved your answers with our backup rules. " + res.error;
    } catch (e) {
      state.error = "Couldn't save to the backend: " + (e.message || e);
    }
  }
  go("thanks");
}

// Booking agent: books the approved terms, then reads the confirmation back and checks it field by field.
async function bookAndVerify(terms, steps) {
  state.screen = "booking";
  await runSteps(steps, "", 600);                                     // AI CALL: booking agent
  const confirmed = { ...terms };
  if (state.test.wrongConfirmation) confirmed[F2.wrongConfirmation.field] = F2.wrongConfirmation.value;
  const mismatches = diffFields(terms, confirmed);
  state.booking = { id: S.booking.confirmationPrefix + Math.floor(100000 + Math.random() * 900000), approved: terms, confirmed, mismatches };
  state.showExternal = false;
  state.metrics.booked++;
  log("booking_executed", { venue: state.selected.id, platform: S.booking.platform, confirmation: state.booking.id }, "ai");
  log("booking_verified", { approvedTerms: terms, confirmedTerms: confirmed, mismatchedFields: mismatches, passed: !mismatches.length }, "ai");
  if (mismatches.length) {
    state.metrics.fails++;
    log("booking_mismatch_flagged", { fields: mismatches.map(k => ({ field: k, approved: terms[k], confirmed: confirmed[k] })) }, "alert");
  }
  if (live()) {
    try {
      const res = await api("/api/book", { session_id: state.pipeline && state.pipeline.session_id, place_id: state.selected.id,
        name: state.selected.name, kind: state.selected.kind, date: state.plan.date, time: confirmed.time });
      state.booking.serverId = res.booking_id;
      state.booking.when = `${state.plan.date}T${to24(confirmed.time)}`;
    } catch (e) { log("book_record_failed", { error: String(e) }, "alert"); }
  }
  go("booked");
}

// ---------- Test mode: pick a scenario, start at the relevant stage ----------
const TM = S.testMode;
const testEl = document.getElementById("test-mode");
let activeScenario = "happy";

function renderTestPanel() {
  const cur = TM.scenarios.find(s => s.id === activeScenario);
  testEl.innerHTML = `
    <div class="tm-title">🧪 Test mode — pick a scenario</div>
    <div class="tm-list">${TM.scenarios.filter(s => MODE.real || !s.liveOnly).map(s =>
      `<button class="tm-btn ${s.id === activeScenario ? "on" : ""}" data-scenario="${s.id}">
         <b>${esc(s.label)}</b><span>${esc(s.startsAt)}</span></button>`).join("")}</div>
    <div class="tm-hint"><b>What to do:</b> ${esc(cur.whatToDo)}</div>`;
}

function nextSaturdayISO() {
  const d = new Date();
  d.setDate(d.getDate() + (((6 - d.getDay() + 7) % 7) || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Fill in the earlier steps (onboarding + plan + picks) with sample data so a scenario can start mid-journey.
function seedEarlierSteps() {
  const t = TM.sampleSetup;
  state.ratings = {};
  for (const v of S.onboardingVenues) {
    state.ratings[v.id] = { a: t.lovedByA.includes(v.id) ? "heart" : "hate", b: t.lovedByB.includes(v.id) ? "heart" : "hate" };
  }
  state.memory = buildMemory(state.ratings);
  state.plan = { ...t.plan, budgets: [...t.plan.budgets], vibes: [...t.plan.vibes], date: nextSaturdayISO() };
  state.current = recommend(state.plan, state.memory, []);
  state.shown = state.current.map(r => r.id);
  state.selected = state.current[0];
  state.booking = null; state.showExternal = false; state.note = "";
  state.review = { a: null, b: null, reasonA: null, reasonB: null };
}

async function startScenario(id) {
  const sc = TM.scenarios.find(s => s.id === id);
  activeScenario = id;
  state.test = { slotGone: !!sc.slotGone, wrongConfirmation: !!sc.wrongConfirmation };
  state.local = !!sc.local;            // failure scenarios run on sample data, never touching the couple's memory
  state.pipeline = null; state.learned = []; state.error = null; state.banner = null;
  if (id === "happy" || id === "demo") {
    // Fresh start of the normal journey.
    state.ratings = Object.fromEntries(state.venues.map(v => [v.id, { a: null, b: null }]));
    state.memory = null; state.selected = null; state.booking = null;
    state.plan = { date: "", time: "", location: "", budgets: [], vibes: [], vegetarian: false };
    state.review = { a: null, b: null, reasonA: null, reasonB: null };
    if (id === "demo") {
      const res = await api("/api/demo", {});
      log("demo_couple_loaded", { partners: res.partners, profile: res.profile }, "alert");
      renderTestPanel();
      return applyMe(res.me, { title: `Loaded the demo couple, ${res.partners[0]} & ${res.partners[1]}`, lines: ["Five past dates and a written profile. Plan a date to see the memory at work."] });
    }
  } else {
    seedEarlierSteps();
    if (sc.prefillReview) state.review = { a: F1.input.a, b: F1.input.b, reasonA: F1.input.reasonA || null, reasonB: F1.input.reasonB || null };
  }
  log("test_scenario_started", {
    scenario: sc.label, startsAt: sc.startsAt, ...state.test,
    ...(sc.local ? { sampleVenue: state.selected.id, sampleDate: state.plan.date } : {}),
    ...(sc.prefillReview ? { prefilled: { [A]: state.review.a, [B]: state.review.b, reason: state.review.reasonB } } : {}),
  }, "alert");
  renderTestPanel();
  lastScreen = null;          // a scenario is a fresh start: always open it at the top
  if (id === "happy" && MODE.real) return go(state.me ? "basics" : "welcome");
  go(sc.screen);
}

testEl.addEventListener("click", e => {
  const btn = e.target.closest("[data-scenario]");
  if (btn) startScenario(btn.dataset.scenario);
});

document.getElementById("home-link").addEventListener("click", e => { e.preventDefault(); goHome(); });

document.getElementById("couple").addEventListener("click", async e => {
  if (e.target.closest("[data-signout]")) return signOut();
  if (!e.target.closest("[data-profile]") || !live()) return;
  try {
    const res = await api("/api/profile");
    state.profileMd = res.profile; state.profileEditing = false; state.profileError = null;
    log("profile_viewed", {});
    go("profile");
  } catch (err) { /* stay where we are */ }
});

screenEl.addEventListener("click", e => {
  const handoff = e.target.closest("[data-handoff]");
  if (handoff) { log("booking_link_opened", { platform: handoff.dataset.handoff, venue: state.selected && state.selected.id }); return; }
  const btn = e.target.closest("[data-act]");
  if (!btn || btn.disabled) return;
  actions[btn.dataset.act](btn.dataset, btn);
});
screenEl.addEventListener("input", e => {
  if (e.target.dataset.auth) state.auth[e.target.dataset.auth] = e.target.value;
  if (e.target.dataset.got) state.got[e.target.dataset.got] = e.target.value;
  if (e.target.dataset.vibe) state.basics[e.target.dataset.vibe].vibe = Number(e.target.value);
});
screenEl.addEventListener("submit", e => {
  e.preventDefault();
  const form = e.target.closest("[data-form]");
  if (form) actions[form.dataset.form]();
});

screenEl.addEventListener("change", e => {
  if (e.target.dataset.got) state.got[e.target.dataset.got] = e.target.value;
  const f = e.target.dataset.field;
  if (!f) return;
  state.plan[f] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  const fb = document.getElementById("find-btn");
  if (fb) fb.disabled = !planReady();
});

async function init() {
  if (location.protocol.startsWith("http")) {
    try {
      // Ask for everything at once so the first screen appears sooner.
      const [st, seedRes, me] = await Promise.all([api("/api/status"), api("/api/seeds"), api("/api/me")]);
      MODE.status = st;
      MODE.real = st.use_real_ai;
      if (MODE.real) {
        const { seeds } = seedRes;
        state.venues = seeds.map(v => ({ ...v, emoji: emojiFor(v.type) }));
        state.ratings = Object.fromEntries(state.venues.map(v => [v.id, { a: null, b: null }]));
        if (me.logged_in) applyMe(me);
        else state.screen = "welcome";
      }
    } catch (e) { MODE.real = false; }  // no backend: run the simulated prototype
  }
  const m = document.getElementById("mode");
  if (m) m.textContent = MODE.real
    ? `${MODE.status.places_live ? "Live venues" : "Sample venues"}${MODE.status.ai_live ? "" : " · backup rules"}`
    : "Sample data";
  renderTestPanel();
  render();
  log("session_started", { couple: [A, B], mode: MODE.real ? "real" : "simulated" });
}
init();
