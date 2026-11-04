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

from store import DATA

URL = "https://places.googleapis.com/v1/places:searchText"
CACHE = DATA / "places_cache"
SAMPLE = DATA / "sample_venues.json"
FIELDS = ",".join(f"places.{f}" for f in [
    "id", "displayName", "formattedAddress", "shortFormattedAddress", "location",
    "rating", "userRatingCount", "priceLevel", "types", "primaryTypeDisplayName",
    "editorialSummary", "regularOpeningHours", "servesVegetarianFood", "reservable",
    "googleMapsUri", "websiteUri",
])
PRICE = {"PRICE_LEVEL_FREE": 0, "PRICE_LEVEL_INEXPENSIVE": 1, "PRICE_LEVEL_MODERATE": 2,
         "PRICE_LEVEL_EXPENSIVE": 3, "PRICE_LEVEL_VERY_EXPENSIVE": 4}
PRICE_ENUM = {v: k for k, v in PRICE.items()}


def live() -> bool:
    return bool(os.getenv("GOOGLE_MAPS_API_KEY"))


def _normalize(p: dict) -> dict:
    return {
        "place_id": p["id"],
        "name": p.get("displayName", {}).get("text", "?"),
        "address": p.get("shortFormattedAddress") or p.get("formattedAddress", ""),
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


def search(query: str, price_levels: range | None = None) -> list[dict]:
    key = hashlib.sha1(f"{live()}|{query}|{list(price_levels or [])}".encode()).hexdigest()[:16]
    cached = CACHE / f"{key}.json"
    if cached.exists():
        return json.loads(cached.read_text())

    if live():
        body = {"textQuery": query, "pageSize": 10}
        if price_levels:
            body["priceLevels"] = [PRICE_ENUM[p] for p in price_levels if p in PRICE_ENUM]
        resp = requests.post(URL, json=body, timeout=20, headers={
            "X-Goog-Api-Key": os.environ["GOOGLE_MAPS_API_KEY"],
            "X-Goog-FieldMask": FIELDS,
        })
        resp.raise_for_status()
        venues = [_normalize(p) for p in resp.json().get("places", [])]
    else:
        venues = _sample_search(query)

    CACHE.mkdir(parents=True, exist_ok=True)
    cached.write_text(json.dumps(venues))
    return venues
