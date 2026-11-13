"""Settings you change in class live in config.json, not in code.

  use_real_ai      false = the web app runs on its built-in simulated responses (Lab 7 behaviour)
  model            the Claude model for every AI step, e.g. claude-haiku-5-5, claude-sonnet-5-5, claude-opus-5-5
  effort           how hard the model thinks, per step: low | medium | high
  use_live_places  false = search the ~30 sample venues instead of Google Places
"""
from __future__ import annotations

import json
import os
from pathlib import Path

PATH = Path(__file__).parent / "config.json"
DEFAULTS = {
    "use_real_ai": True,
    "model": "claude-haiku-5-5",
    "effort": {"write_queries": "low", "recommend": "medium", "update_profile": "medium"},
    "use_live_places": True,
    "port": 8000,
}


def load() -> dict:
    """Re-read on every call, so edits to config.json apply without restarting the server."""
    cfg = json.loads(PATH.read_text()) if PATH.exists() else {}
    merged = {**DEFAULTS, **cfg, "effort": {**DEFAULTS["effort"], **cfg.get("effort", {})}}
    if os.getenv("DATE_NIGHT_MODEL"):        # the test runner's --model flag
        merged["model"] = os.environ["DATE_NIGHT_MODEL"]
    return merged
