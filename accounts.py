"""Couple accounts: one login per couple (a username and a shared password).

Each account is DATA/couples/<username>/account.json, next to that couple's data.
Passwords are stored as salted hashes, never as the password itself.
"""
from __future__ import annotations

import json
import re
import secrets
from datetime import datetime

from werkzeug.security import check_password_hash, generate_password_hash

import store

USERNAME = re.compile(r"^[a-z0-9][a-z0-9-]{2,29}$")
DEMO = "maya-and-sam"          # the demo couple; reserved, opened with "Try the demo", not a password


def _file(username: str):
    return store.COUPLES / username / "account.json"


def exists(username: str | None) -> bool:
    return bool(username) and _file(username).exists()


def load(username: str) -> dict:
    return json.loads(_file(username).read_text())


def create(username: str, password: str, name_a: str, name_b: str) -> str | None:
    """Create the account and its couple. Returns an error message, or None when it worked."""
    username = (username or "").strip().lower()
    name_a, name_b = (name_a or "").strip(), (name_b or "").strip()
    if not USERNAME.match(username):
        return "Use 3 to 30 lowercase letters, numbers or dashes for the username, like maya-and-sam."
    if username == DEMO or exists(username):
        return "That username is taken. Try another."
    if not name_a or not name_b:
        return "Enter both first names."
    if len(password or "") < 6:
        return "Use a password with at least 6 characters."
    _file(username).parent.mkdir(parents=True, exist_ok=True)
    _file(username).write_text(json.dumps({
        "username": username, "names": [name_a, name_b],
        "password_hash": generate_password_hash(password),
        "created": datetime.now().isoformat(timespec="seconds"),
    }, indent=2))
    store.use_couple(username)
    store.save_couple({"partners": [{"name": name_a}, {"name": name_b}]})
    return None


def verify(username: str, password: str) -> bool:
    username = (username or "").strip().lower()
    if username == DEMO or not exists(username):
        return False
    return check_password_hash(load(username)["password_hash"], password or "")


def ensure_demo() -> None:
    """The demo couple's account exists, with an unguessable password nobody uses."""
    if not exists(DEMO):
        _file(DEMO).parent.mkdir(parents=True, exist_ok=True)
        _file(DEMO).write_text(json.dumps({
            "username": DEMO, "names": ["Maya", "Sam"], "demo": True,
            "password_hash": generate_password_hash(secrets.token_urlsafe(32)),
            "created": datetime.now().isoformat(timespec="seconds"),
        }, indent=2))
