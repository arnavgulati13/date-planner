# Date Night

An AI date-night assistant for couples. It learns both partners' tastes, recommends up to 3 venues they'd both want to go back to, books the one they approve, and updates what it knows after every date.

This is the web app from Lab 7 connected to a real AI model (Lab 8). The design history is in [docs/implementation-plan.md](docs/implementation-plan.md).

## What's real and what's simulated

| Step | How it works now |
|---|---|
| Onboarding → first profile | **Real AI.** Claude reads both partners' ♥/✕ ratings and writes the couple's taste profile. |
| Plan → 3 picks | **Real AI.** Claude writes Google Maps searches, Google Places finds venues, plain code removes anything that breaks the hard rules (closed then, out of budget, no vegetarian options, rated under 4.2, visited in the last 60 days), then Claude picks 3 and explains each one. |
| "% you'd both go back" | **An AI estimate, not a measured probability.** It stands in for the return-probability model from Assignment 3 until there are enough post-date check-ins to train one. |
| Booking | **Simulated.** OpenTable and Resy have no public booking API. The approval screen, the "slot is gone" stop, and the Approved vs. Confirmed check all work on simulated data. |
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

Then open **http://localhost:8000** in your browser. The badge in the top bar says whether you're on real AI, and which model. To stop the app, press Ctrl+C in the Terminal.

## Try it

- **Happy path:** rate the 14 spots, plan a date, pick one, Allow, then click **Fast-forward: after the date** and answer the check-in.
- **Demo couple:** in Test mode (top of the right-hand column), pick **Demo couple with 5 past dates**. It loads Maya & Sam with a history, so the picks can cite past dates.
- **Failure scenarios:** the other Test mode options start at the relevant step on sample data, with a "What to do" hint.

## Settings: `config.json`

| Setting | What it does |
|---|---|
| `model` | The Claude model for every AI step. Starts on `claude-haiku-5-5` (fastest, cheapest). Try `claude-sonnet-5-5` or `claude-opus-5-5` to compare. |
| `use_real_ai` | `false` switches the whole app back to the Lab 7 simulated responses. |
| `effort` | How hard the model thinks at each step: `low`, `medium` or `high`. |
| `use_live_places` | `false` searches the sample venues instead of Google Places. |

Changes apply on the next request; there's no need to restart the server.

## Where to look while testing

- **`logs/ai_log.jsonl`:** one line per AI request (the exact input sent, the output returned, the model, response time, tokens, any error) and one line per click in the app. Open it in any text editor. The same entries show in the app's right-hand log.
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
| `store.py` | The couple, profile and event log in `data/`. |
| `config.py` + `config.json` | The settings above. |
| `ailog.py` | Writes `logs/ai_log.jsonl`. |
| `scripts/seed_demo.py` | The demo couple. |
| `tests/` | Unit tests for the hard rules: `.venv/bin/python -m pytest tests` |
