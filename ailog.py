"""The testing log: logs/ai_log.jsonl.

One line per AI request (the input sent, the output returned, the model, timing,
any error) and one line per click the web app reports (picks, Generate more,
booking decisions, review answers). Open the file in any text editor during
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
    if kind == "ai_call" and _captured.get() is not None:
        _captured.get().append(entry)
    return entry
