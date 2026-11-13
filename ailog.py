"""The testing log: logs/ai_log.jsonl.

Three kinds of line:
  ai_call     every Claude request: the instructions (system prompt) and input values sent,
              the output returned, confidence scores (return_chance), model, timing, tokens, errors
  agent_step  every other step of the picks pipeline: each Google Places search (what was sent,
              what came back), the hard-rule filter (what was kept and dropped), the final picks
  ui_event    every click the web app reports (ratings, picks, Generate more, booking decisions, reviews) Open the file in any text editor during
testing. This is separate from data/events.jsonl, which is the couple's memory.
"""
from __future__ import annotations

import contextvars
import json
from datetime import datetime
from pathlib import Path

LOG = Path(__file__).parent / "logs" / "ai_log.jsonl"

# AI calls made while handling one web request, so the server can send them back
# to the web app's on-screen log as well.
_captured: contextvars.ContextVar[list | None] = contextvars.ContextVar("captured", default=None)


def start_capture() -> None:
    _captured.set([])


def captured() -> list[dict]:
    return _captured.get() or []


def write(kind: str, **fields) -> dict:
    entry = {"ts": datetime.now().isoformat(timespec="seconds"), "kind": kind, **fields}
    LOG.parent.mkdir(exist_ok=True)
    with LOG.open("a") as f:
        f.write(json.dumps(entry, default=str) + "\n")
    if kind in ("ai_call", "agent_step") and _captured.get() is not None:
        _captured.get().append(entry)
    return entry
