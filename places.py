"""Step 2a: venue search with Google Places Text Search (New).

Every response is cached on disk, so repeat searches are instant and the demo
survives a dead network. With no GOOGLE_MAPS_API_KEY set, searches run against
data/sample_venues.json instead (offline demo mode).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path

import requests

import ailog
import config
import geo

URL = "https://places.googleapis.com/v1/places:searchText"
REPO_DATA = Path(__file__).parent / "data"          # shared by tests and real use, whatever DATE_NIGHT_DATA says
CACHE = Path(os.getenv("DATE_NIGHT_CACHE") or REPO_DATA / "places_cache")   # e.g. /data/places_cache on Railway
SAMPLE = REPO_DATA / "sample_venues.json"
FIELDS = ",".join(f"places.{f}" for f in [
    "id", "displayName", "formattedAddress", "shortFormattedAddress", "location",
    "rating", "userRatingCount", "priceLevel", "types", "primaryTypeDisplayName",
    "editorialSummary", "regularOpeningHours", "servesVegetarianFood", "reservable",
    "googleMapsUri", "websiteUri", "nationalPhoneNumber",
])
PRICE = {"PRICE_LEVEL_FREE": 0, "PRICE_LEVEL_INEXPENSIVE": 1, "PRICE_LEVEL_MODERATE": 2,
         "PRICE_LEVEL_EXPENSIVE": 3, "PRICE_LEVEL_VERY_EXPENSIVE": 4}
PRICE_ENUM = {v: k for k, v in PRICE.items()}


def live() -> bool:
    return bool(os.getenv("GOOGLE_MAPS_API_KEY")) and config.load()["use_live_places"]


def _normalize(p: dict) -> dict:
    return {
        "place_id": p["id"],
        "name": p.get("displayName", {}).get("text", "?"),
        "address": geo.clean_address(p.get("shortFormattedAddress") or p.get("formattedAddress", "")),
        "lat": p.get("location", {}).get("latitude"),
        "lng": p.get("location", {}).get("longitude"),
        "price_level": PRICE.get(p.get("priceLevel")),
        "rating": p.get("rating"),
        "rating_count": p.get("userRatingCount"),
        "type": p.get("primaryTypeDisplayName", {}).get("text", ""),
        "types": p.get("types", []),
        "summary": p.get("editorialSummary", {}).get("text", ""),
        "hours": p.get("regularOpeningHours", {}).get("periods"),
        "serves_vegetarian": p.get("servesVegetarianFood"),
        "reservable": p.get("reservable"),
        "maps_url": p.get("googleMapsUri"),
        "website": p.get("websiteUri"),
        "phone": p.get("nationalPhoneNumber"),
    }


def _sample_search(query: str) -> list[dict]:
    """Offline stand-in: rank sample venues by word overlap with the query,
    restricted to the neighbourhood named in the query when there is one."""
    venues = json.loads(SAMPLE.read_text())
    q = query.lower()
    words = set(re.findall(r"[a-z]+", q)) - {"in", "the", "a", "and", "chicago", "restaurant", "bar"}
    local = [v for v in venues if v["neighborhood"].lower() in q] or venues

    def score(v):
        text = " ".join([v["name"], v["type"], v["summary"], " ".join(v.get("tags", []))]).lower()
        return sum(w in text for w in words) + v["rating"] / 10

    return sorted(local, key=score, reverse=True)[:10]


def search(query: str, price_levels: range | None = None, area: str = "") -> list[dict]:
    """One tool step of the agent: run a search the model wrote. Logged to logs/ai_log.jsonl."""
    sent = {"query": query, "price_levels": list(price_levels or []), "near": area or None}
    center = geo.center(area) if area else None
    # "v2": results gained the phone number, so older cached results are fetched again
    key = hashlib.sha1(f"v2|{live()}|{query}|{list(price_levels or [])}|{center}".encode()).hexdigest()[:16]
    cached = CACHE / f"{key}.json"
    if cached.exists():
        venues = json.loads(cached.read_text())
        _log(sent, venues, "cache")
        return venues

    if live():
        body = {"textQuery": query, "pageSize": 10}
        if center:      # prefer results near the chosen neighborhood
            body["locationBias"] = {"circle": {"center": {"latitude": center[0], "longitude": center[1]},
                                               "radius": geo.MAX_MILES * 1609.0}}
        if price_levels:
            body["priceLevels"] = [PRICE_ENUM[p] for p in price_levels if p in PRICE_ENUM]
        try:
            resp = requests.post(URL, json=body, timeout=20, headers={
                "X-Goog-Api-Key": os.environ["GOOGLE_MAPS_API_KEY"],
                "X-Goog-FieldMask": FIELDS,
            })
            resp.raise_for_status()
        except requests.RequestException as e:
            ailog.write("agent_step", tool="google_places_search", sent=sent, returned=None, error=str(e))
            raise
        venues = [_normalize(p) for p in resp.json().get("places", [])]
        source = "google_places_live"
    else:
        venues = _sample_search(query)
        source = "sample_venues"

    CACHE.mkdir(parents=True, exist_ok=True)
    cached.write_text(json.dumps(venues))
    _log(sent, venues, source)
    return venues


def _log(sent: dict, venues: list[dict], source: str) -> None:
    ailog.write("agent_step", tool="google_places_search", sent=sent, returned={
        "source": source, "count": len(venues),
        "venues": [{"name": v["name"], "price_level": v.get("price_level"), "rating": v.get("rating")} for v in venues],
    }, error=None)
