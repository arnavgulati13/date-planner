# Date Night — MVP prototype

An AI date planner for couples. It learns the couple's shared taste, writes searches for the area they choose, filters the results against hard rules in code, picks 3 options (2 best fits + 1 wildcard), and rewrites its memory after every date.

The design is in [docs/implementation-plan.md](docs/implementation-plan.md), and there's a one-page diagram in [docs/how-it-works.png](docs/how-it-works.png).

## Run it

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv -r requirements.txt
cp .env.example .env        # then add your keys (optional, see below)
.venv/bin/streamlit run app.py
```

Then open http://localhost:8501. Go to **Setup → Load the demo couple** to start with a couple that has 5 past dates, or onboard your own.

### Keys and offline mode

| Key in `.env` | With it | Without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude writes the searches, ranks the venues and rewrites the profile | A simple keyword heuristic stands in (labelled "offline" in the app) |
| `GOOGLE_MAPS_API_KEY` (Places API (New) enabled) | Live venue search in any area | ~30 sample Chicago venues in `data/sample_venues.json` |

The sidebar shows which mode each piece is running in. Places responses are cached in `data/places_cache/`, so a demo still works if the network fails, as long as the same searches were run beforehand.

### Demo tip

After booking a date, turn on **⏩ Demo: jump to after the date** in the sidebar. The post-date check-in appears straight away, and saving it shows the **What we learned** panel.

## Files

| File | What it does |
|---|---|
| `app.py` | The Streamlit screens: setup/onboarding, plan, results, booked, check-in, profile |
| `llm.py` + `prompts/` | The 3 Claude steps: `write_queries`, `recommend`, `update_profile` |
| `places.py` | Google Places Text Search with on-disk cache, plus the offline sample search |
| `filter.py` | The constraint filter (open then, budget, vegetarian, rating ≥ 4.2, not visited in 60 days) |
| `store.py` | `couple.json`, `profile.md`, `events.jsonl` in `data/`, plus the stats |
| `scripts/seed_demo.py` | The made-up demo couple (Maya & Sam). Edit it to use your own context. |
| `tests/test_filter.py` | Unit tests for the constraint filter: `.venv/bin/python -m pytest tests` |
