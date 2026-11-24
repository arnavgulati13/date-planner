# Date Night

An AI date-night assistant for couples. It learns both partners' tastes, recommends up to 3 venues they'd both want to go back to, books the one they approve, and updates what it knows after every date.

This is the web app from Lab 7 connected to a real AI model (Lab 8). The design history is in [docs/implementation-plan.md](docs/implementation-plan.md).

## What's real and what's simulated

| Step | How it works now |
|---|---|
| Onboarding → first profile | **Real AI.** Claude reads both partners' ♥/✕ ratings and writes the couple's taste profile. |
| Plan → 3 picks | **Real AI.** Claude writes Google Maps searches, Google Places finds venues, plain code removes anything that breaks the hard rules (closed then, out of budget, no vegetarian options, rated under 4.2, visited in the last 60 days), then Claude picks 3 and explains each one. |
| "% you'd both go back" | **An AI estimate, not a measured probability.** It stands in for the return-probability model from Assignment 3 until there are enough post-date check-ins to train one. |
| Booking | **Real, made by the couple.** OpenTable, Resy, SevenRooms and Tock have no public booking API, so `booking.py` finds each pick's own booking page on the restaurant's website (cached for two weeks), and the pick card says how it books ("Books on OpenTable", "Reserve through Google", "Walk-in only", "Call to book"). After **Allow** the app offers only what works for that venue: its booking page with the date, time and party size filled in (Resy: date and party), Google's "Reserve a table", or the phone number. It can tell *where* a venue takes bookings, not *whether* the time is still free. The couple books with one tap, comes back, and says what they got. The Approved vs. Confirmed check flags any difference, "Couldn't get it" leads back to the other picks, and **Add to calendar** saves the date. Test-mode failure scenarios still use the simulated booking agent. |
| Post-date check-in → profile update | **Real AI.** Each partner answers separately. A split is saved as split; a skip is saved as missing and changes nothing. Then Claude rewrites the profile and says what it learned. |
| Test mode failure scenarios | **Always simulated**, so testing them never touches the couple's real profile. |

## Set it up on your laptop (about 10 minutes)

You need Python 3.12 and [uv](https://docs.astral.sh/uv/getting-started/installation/) (a tool that installs Python packages). Open the Terminal app in this folder, then run each line:

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv -r requirements.txt
cp .env.example .env
```

**Add your own API key.** Open the new `.env` file in a text editor and paste your key after `ANTHROPIC_API_KEY=`. Get a key at [console.anthropic.com](https://console.anthropic.com): buy a few dollars of credits (separate from a Claude.ai subscription), then create a key. The Google Maps key is optional. Never share your `.env` file or paste a key into a chat.

**Start the app:**

```bash
.venv/bin/python server.py
```

Then open **http://localhost:8000** in your browser. The badge in the demo tools says whether venues are live; the model in use is in `config.json` and `logs/ai_log.jsonl`. To stop the app, press Ctrl+C in the Terminal.

## Try it

- **Front door:** **Create your couple account** (a couple username, a shared password and both first names), **Log in**, or **Try the demo**.
- **New couple:** after creating the account you go through setup once: each partner's basics side by side (food needs, "never" answers, cozy-to-lively), then rating spots together (♥, ✕ or "Not been"), then "What we know about you two", which you can correct.
- **Returning couple:** logging in goes straight to Plan a date. If a booked date has passed without a review, the app asks how it went first. You stay logged in on that device for 30 days.
- **Demo:** **Try the demo** logs in as Maya & Sam with five past dates and a written profile, reset each time. Real couples never see it.
- **Planning:** plan a date, pick one, Allow, then click **Fast-forward: after the date** and answer the check-in.
- **Failure scenarios:** the other Test mode options start at the relevant step on sample data, with a "What to do" hint.

**Test cases:** [TEST_CASES.md](TEST_CASES.md) has the 5 Lab 8 cases. Run cases 1–4 automatically with `.venv/bin/python -m scripts.run_test_cases`.

## Deploy on Railway

Railway deploys straight from this GitHub repo and redeploys on every merge to `main`. `railway.json` already sets the production start command (gunicorn) and the `/healthz` health check.

1. **Volume:** in the service, add a Volume mounted at `/data`. This keeps the couple, the log and the venue cache across restarts.
2. **Variables:** in the service's Variables tab, add these. Paste the keys yourself; never commit them.

   | Variable | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your key |
   | `GOOGLE_MAPS_API_KEY` | optional; without it the app uses the sample venues |
   | `DATE_NIGHT_DATA` | `/data/couple` |
   | `DATE_NIGHT_LOGS` | `/data/logs` |
   | `DATE_NIGHT_CACHE` | `/data/places_cache` |

3. **Domain:** Settings → Networking → Generate Domain.
4. **Spending caps:** set a monthly limit in the Anthropic console, and a daily quota on the Google key.

**Accounts:** each couple's account and data live in their own folder on the volume (`/data/couple/couples/<username>/`), with the password stored as a salted hash. The login cookie is signed with a key the app creates on the volume the first time it runs; set a `SECRET_KEY` variable only if you want to choose it yourself. There's no site-wide password and no usage limit, so set a monthly spending cap in the Anthropic console.

## Settings: `config.json`

| Setting | What it does |
|---|---|
| `model` | The Claude model for every AI step. Starts on `claude-haiku-5-5` (fastest, cheapest). Try `claude-sonnet-5-5` or `claude-opus-5-5` to compare. |
| `use_real_ai` | `false` switches the whole app back to the Lab 7 simulated responses. |
| `effort` | How hard the model thinks at each step: `low`, `medium` or `high`. |
| `use_live_places` | `false` searches the sample venues instead of Google Places. |

Changes apply on the next request; there's no need to restart the server.

## Where to look while testing

- **`logs/ai_log.jsonl`:** open it in any text editor. The same entries show in the app's right-hand log. It has three kinds of line:
  - `ai_call`: every Claude request, with the instructions (system prompt) and input values sent, the output returned, the confidence scores ("% you'd both go back"), the model, response time, tokens and any error.
  - `agent_step`: every other step of the picks pipeline. That's each Google Places search (what was sent, what came back), the hard-rule filter (what was kept and dropped, and why) and the final picks.
  - `ui_event`: every click in the app (ratings, picks, Generate more, booking decisions, review answers).
- **`data/profile.md`:** what the app currently believes about the couple.
- **`data/events.jsonl`:** every rating, pick, booking and check-in, which is the training data a future model would learn from.

All three stay on your laptop and are never uploaded.

## Files

| File | What it does |
|---|---|
| `server.py` | The backend. Serves the web app and the `/api` endpoints. |
| `web/` | The web app (`index.html`, `app.js`, `styles.css`) and `simulated_responses.js`, which holds every simulated response. |
| `llm.py` + `prompts/` | The three Claude steps: `write_queries`, `recommend`, `update_profile`. Every call goes through one function, `_call`. |
| `places.py` | Google Places search, cached on disk, with the sample venues as a fallback. |
| `filter.py` | The hard rules, in plain code. |
| `booking.py` | Finds where each pick takes bookings (OpenTable, Resy, SevenRooms, Tock) from its website. |
| `store.py` | The couple, profile and event log in `data/`. |
| `config.py` + `config.json` | The settings above. |
| `ailog.py` | Writes `logs/ai_log.jsonl`. |
| `scripts/seed_demo.py` | The demo couple. |
| `tests/` | Unit tests for the hard rules: `.venv/bin/python -m pytest tests` |
