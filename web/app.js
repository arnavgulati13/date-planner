// Date Night web app — UI flow.
// Real mode (served by server.py with use_real_ai on): onboarding, picks and the
// post-date memory update call the backend, which calls Claude. Booking stays simulated.
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
  if (!res.ok) throw new Error(`${path} failed (${res.status})`);
  const data = await res.json();
  for (const c of data.ai_calls || []) {         // show each real AI call in the on-screen log
    log(`ai_call · ${c.step}`, { model: c.model, effort: c.effort, latency_ms: c.latency_ms,
      tokens: c.usage, error: c.error, output: c.output }, c.error ? "alert" : "ai", false);
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
  onboarding() {
    const vs = state.venues;
    const done = vs.filter(v => state.ratings[v.id].a && state.ratings[v.id].b).length;
    const rateBtns = (id, who) => {
      const r = state.ratings[id][who];
      return `<div class="rate-btns">
        <button class="rb heart ${who} ${r === "heart" ? "on" : ""}" data-act="rate" data-id="${id}" data-who="${who}" data-val="heart" aria-label="heart">♥</button>
        <button class="rb hate ${r === "hate" ? "on" : ""}" data-act="rate" data-id="${id}" data-who="${who}" data-val="hate" aria-label="hate">✕</button>
      </div>`;
    };
    return `
      <span class="step-tag">Step 1 · Onboarding · first time only</span>
      <h1>Rate spots you know</h1>
      <p class="sub">${A} and ${B}, each tap ♥ or ✕ on places you've been. This is our starting point.</p>
      <div class="progress"><div style="width:${(100 * done) / vs.length}%"></div></div>
      <div class="venues">${vs.map(v => `
        <div class="venue-row ${state.ratings[v.id].a && state.ratings[v.id].b ? "done" : ""}">
          <div class="venue-head"><div class="emoji">${v.emoji}</div>
            <div><div class="vname">${esc(v.name)}</div><div class="vmeta">${esc(v.type)} · ${esc(v.hood)}</div></div></div>
          <div class="rate-line"><span class="who a">${A}</span>${rateBtns(v.id, "a")}</div>
          <div class="rate-line"><span class="who b">${B}</span>${rateBtns(v.id, "b")}</div>
        </div>`).join("")}</div>
      <button class="btn" data-act="finishOnboarding" ${done < vs.length ? "disabled" : ""}>Continue</button>
      <p class="hint">${done} of ${vs.length} rated by both</p>`;
  },

  plan() {
    const p = state.plan, o = S.planOptions;
    const chips = (key, opts) => `<div class="chips">${opts.map(x =>
      `<button class="chip ${p[key].includes(x) ? "on" : ""}" data-act="chip" data-key="${key}" data-val="${x}">${x}</button>`).join("")}</div>`;
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
      <p class="sub">${p.time} · ${esc(p.location)} · ${p.budgets.join("/")} · ${p.vibes.join(", ")}${p.vegetarian ? " · vegetarian" : ""}</p>
      ${pipelineSummary()}
      ${recs.length ? `<div class="recs">` + recs.map((r, i) => `
        <div class="rec">
          <div class="badge ${r.badge}">${r.badge === "best" ? "★ Best fit" : "+ Wildcard"}</div>
          <h3>${esc(r.name)}</h3>
          <div class="meta">${esc(r.type)} · ${r.price} · ${r.rating}★ · ${r.distance}</div>
          ${r.headline ? `<p class="headline">${esc(r.headline)}</p>` : ""}
          <p class="why">${esc(r.why)}</p>
          ${r.showFlag ? `<div class="flag">⚠ ${esc(r.flag)}</div>` : ""}
          <div class="pills"><span class="pill slot">${r.openSlot} open</span>${r.percent != null ? `<span class="pill">~${r.percent}% you'd both go back</span>` : ""}</div>
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
      <p class="sub">${esc(fill(S.booking.confirmPrompt, { venue: r.name }))}</p>
      <div class="summary">
        <div class="line"><span class="k" style="font-weight:700;color:var(--ink)">You're approving exactly:</span><span class="v"></span></div>
        ${TERM_FIELDS.map(([k, label]) => `<div class="line"><span class="k">${label}</span><span class="v">${esc(t[k])}</span></div>`).join("")}
        <div class="line"><span class="k">Via</span><span class="v">${esc(S.booking.platform)}</span></div>
      </div>
      <p class="hint" style="margin:-6px 0 14px">If any of these change, we'll stop and ask you again before booking.</p>
      <button class="btn" data-act="allow">Allow</button>
      <button class="btn secondary" data-act="deny">Deny</button>`;
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
      <p class="sub center">${esc(bad ? F2.mismatchWarning : S.booking.successMessage)}</p>
      <div class="summary">
        <div class="line"><span class="k">${esc(c.venue)}</span><span class="v">${esc(c.date)}</span></div>
        <div class="line"><span class="k">${esc(c.time)} · party of ${c.partySize}</span><span class="v">#${b.id}</span></div>
      </div>
      <label class="f" style="margin-top:0">Booking check</label>
      ${termsTable(b.approved, c, "Approved", "Confirmed", { markBad: true })}
      <div style="height:14px"></div>
      <button class="btn secondary" data-act="toggleExternal">${state.showExternal ? "Hide" : "View"} booking confirmation ↗</button>
      ${state.showExternal ? `
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
  const by = p.source === "claude" ? `Picked by Claude (${p.model})` : "Picked by the fallback heuristic";
  const dropped = Object.entries(p.dropped || {}).map(([r, n]) => `${n} ${r}`).join(", ");
  return `<details class="how"><summary>${esc(by)} · ${p.found} found → ${p.kept} passed your rules → ${state.current.length} picked</summary>
    <div><b>Searches Claude wrote:</b> ${p.queries.map(q => `“${esc(q)}”`).join(" · ")}</div>
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

function planReady() {
  const p = state.plan;
  return p.date && p.time && p.location && p.budgets.length && p.vibes.length;
}

function render() {
  screenEl.innerHTML = screens[state.screen]();
  screenEl.scrollTop = 0;
  if (window.onScreenChange) window.onScreenChange(state.screen);   // updates the step bar in index.html
}
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
        reason, api("/api/recommend", { ...state.plan, note: state.note, exclude: state.shown }));
      state.pipeline = res;
      state.current = res.picks.map(p => ({
        id: p.id, name: p.name, type: p.type, price: p.price, rating: p.rating ?? "?", distance: p.address,
        headline: p.headline, why: p.why, percent: p.return_chance, openSlot: state.plan.time,
        showFlag: !!p.heads_up, flag: p.heads_up, badge: p.kind === "wildcard" ? "wild" : "best", kind: p.kind,
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
}

// ---------- actions ----------
const actions = {
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
      const res = await whileLoading(["Saving your ratings", "Writing your first profile"],
        "Building what we know about you two.", api("/api/onboard", { ratings: state.ratings, partners: [A, B] }));
      state.banner = { title: "🧠 What we know so far", lines: res.learned };
      log("memory_initialized", { learned: res.learned, profile: res.profile, error: res.error }, "ai");
    } catch (e) {
      state.banner = { title: "Couldn't save onboarding", lines: [String(e.message || e)] };
    }
    go("plan");
  },
  chip(d) {
    const arr = state.plan[d.key];
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
    state.plan = { date: "", time: "", location: "", budgets: [], vibes: [], vegetarian: false };
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
      if (res.error) state.error = "Profile updated by the fallback heuristic: " + res.error;
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
      [A, B] = res.partners;
      state.banner = { title: `Loaded the demo couple, ${A} & ${B}`, lines: ["Five past dates and a written profile. Plan a date to see the memory at work."] };
      log("demo_couple_loaded", { partners: res.partners, profile: res.profile }, "alert");
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
  go(sc.screen);
}

testEl.addEventListener("click", e => {
  const btn = e.target.closest("[data-scenario]");
  if (btn) startScenario(btn.dataset.scenario);
});

screenEl.addEventListener("click", e => {
  const btn = e.target.closest("[data-act]");
  if (!btn || btn.disabled) return;
  actions[btn.dataset.act](btn.dataset, btn);
});
screenEl.addEventListener("change", e => {
  const f = e.target.dataset.field;
  if (!f) return;
  state.plan[f] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  const fb = document.getElementById("find-btn");
  if (fb) fb.disabled = !planReady();
});

async function init() {
  if (location.protocol.startsWith("http")) {
    try {
      const st = await api("/api/status");
      MODE.status = st;
      MODE.real = st.use_real_ai;
      if (MODE.real) {
        const { seeds } = await api("/api/seeds");
        state.venues = seeds.map(v => ({ ...v, emoji: emojiFor(v.type) }));
        state.ratings = Object.fromEntries(state.venues.map(v => [v.id, { a: null, b: null }]));
        if (st.couple) {                 // a couple is already set up: start at Plan
          [A, B] = st.partners;
          state.banner = { title: `Welcome back, ${A} & ${B}`, lines: ["Plan your next date, or pick Happy path in Test mode to start over."] };
          state.screen = "plan";
        }
      }
    } catch (e) { MODE.real = false; }  // no backend: run the simulated prototype
  }
  const m = document.getElementById("mode");
  if (m) m.textContent = MODE.real
    ? `Real AI · ${MODE.status.model}${MODE.status.claude_live ? "" : " (no key: fallback)"} · ${MODE.status.places_live ? "live venues" : "sample venues"}`
    : "Simulated AI";
  renderTestPanel();
  render();
  log("session_started", { couple: [A, B], mode: MODE.real ? "real" : "simulated", model: MODE.status && MODE.status.model });
}
init();
