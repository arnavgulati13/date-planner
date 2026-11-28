"""Where does a venue take bookings? Plain code, no AI.

OpenTable, Resy, SevenRooms and Tock have no public API, but restaurants link to their own booking
page from their website. We fetch the website (and its reservations page, if the home page doesn't
link one), find that link, and cache the answer per venue. This tells the couple *where* to book,
not *whether* their time is still free: only the platform knows that.
"""
from __future__ import annotations

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin, urlparse

import requests

import ailog
from places import CACHE

DIR = CACHE / "booking_v2"          # v2: links must name the venue (v1 could pick a sister restaurant)
MAX_AGE = 14 * 24 * 3600            # restaurants switch platforms now and then
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                         "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"}

# Each pattern finds a link to one restaurant's page (not the platform's home page).
PATTERNS = [
    ("Resy", re.compile(r"https?://(?:www\.)?resy\.com/cities/[a-z-]+/(?:venues/)?[a-z0-9-]+", re.I)),
    ("OpenTable", re.compile(r"https?://(?:www\.)?opentable\.com/(?:r/[a-z0-9-]+|restref/client/?\?[^\"'\s<>]*?(?:rid|restref)=\d+)", re.I)),
    ("SevenRooms", re.compile(r"https?://(?:www\.)?sevenrooms\.com/(?:reservations|explore)/[a-z0-9_-]+", re.I)),
    ("Tock", re.compile(r"https?://(?:www\.)?exploretock\.com/[a-z0-9_-]+", re.I)),
]
OT_WIDGET = re.compile(r"opentable\.com/widget/reservation/loader\?[^\"'\s<>]*?rid=(\d+)", re.I)
NOT_VENUE = {"search", "about", "city", "cities", "login", "signup", "explore", "api", "widget", "reservations", "tock", "join", "home"}


STOP = {"the", "and", "bar", "restaurant", "chicago", "cafe", "kitchen", "grill", "lounge", "cocktail", "cocktails",
        "west", "loop", "house", "room", "tavern", "pub", "club", "co"}


def _compact(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower().replace("\u2019", "").replace("'", ""))


def names_venue(slug: str, name: str) -> bool:
    """Does a booking link's slug belong to this venue? Restaurant groups link their sister
    restaurants too: Ciccio Mio's site links to Bavette's Resy page."""
    slug = _compact(slug)
    words = [_compact(w) for w in re.split(r"[\s&+/-]+", name.split("|")[0].split(" - ")[0].split("(")[0])]
    words = [w for w in words if len(w) >= 3 and w not in STOP]
    whole = _compact(name.split("|")[0].split(" - ")[0].split("(")[0])
    return any(w in slug for w in words) or (len(whole) >= 5 and whole[:8] in slug)


def find_link(html: str, name: str | None = None) -> tuple[str, str] | None:
    """(platform, booking page URL) from a page's HTML, or None. With a venue name, a link whose
    slug names a different restaurant is skipped. OpenTable restref links carry only a number,
    so they can't be checked and are trusted."""
    html = html.replace("&amp;", "&").replace("\\/", "/")
    for platform, pat in PATTERNS:
        for m in pat.finditer(html):
            url = m.group(0)
            last = urlparse(url).path.rstrip("/").rsplit("/", 1)[-1].lower()
            if platform in ("Resy", "Tock", "SevenRooms") and last in NOT_VENUE:
                continue
            if name and "restref" not in url and not names_venue(last, name):
                continue
            return platform, _clean(platform, url)
    m = OT_WIDGET.search(html)
    if m:
        return "OpenTable", f"https://www.opentable.com/restref/client/?rid={m.group(1)}"
    return None


def _clean(platform: str, url: str) -> str:
    """One plain https link per restaurant, so the app can add the date, time and party size to it."""
    url = re.sub(r"^http://", "https://", url)
    if platform == "Resy":
        return re.sub(r"/cities/([a-z-]+)/(?!venues/)", r"/cities/\1/venues/", url)
    if platform == "SevenRooms":                       # /explore/<slug> takes the same slug at /reservations/
        return url.replace("/explore/", "/reservations/")
    if platform == "OpenTable" and "restref/client" in url:
        key, rid = re.search(r"(rid|restref)=(\d+)", url).groups()
        return f"https://www.opentable.com/restref/client/?{key}={rid}"
    return url


def _get(url: str) -> str:
    r = requests.get(url, headers=HEADERS, timeout=5)
    r.raise_for_status()
    return r.text[:600_000]


def _reservation_page(html: str, base: str) -> str | None:
    """A same-site link that looks like the reservations page: /reservations, /book, ..."""
    host = urlparse(base).netloc
    for href in re.findall(r'href=["\']([^"\'#]+)["\']', html):
        url = urljoin(base, href)
        if urlparse(url).netloc == host and re.search(r"reserv|book", urlparse(url).path, re.I):
            return url
    return None


def detect(website: str | None, name: str | None = None) -> dict:
    """{"platform", "url"} for the venue's own booking page; platform None when none was found."""
    if not website:
        return {"platform": None, "url": None, "checked": "no website"}
    found = find_link(website, name)    # the "website" is sometimes the booking page itself
    if found:
        return {"platform": found[0], "url": found[1], "checked": "website is the booking page"}
    try:
        html = _get(website)
        found = find_link(html, name)
        if not found and (page := _reservation_page(html, website)):
            found = find_link(_get(page), name)
    except requests.RequestException as e:
        return {"platform": None, "url": None, "checked": f"website didn't load ({type(e).__name__})"}
    if found:
        return {"platform": found[0], "url": found[1], "checked": "found on their website"}
    return {"platform": None, "url": None, "checked": "no booking link on their website"}


def lookup(venues: list[dict]) -> dict[str, dict]:
    """Booking info for each venue, by place_id: cached for two weeks, otherwise checked in parallel."""
    DIR.mkdir(parents=True, exist_ok=True)
    out, todo = {}, []
    for v in venues:
        f = DIR / f"{v['place_id']}.json"
        if f.exists() and time.time() - f.stat().st_mtime < MAX_AGE:
            out[v["place_id"]] = json.loads(f.read_text())
        else:
            todo.append(v)
    with ThreadPoolExecutor(max_workers=len(todo) or 1) as pool:
        for v, info in zip(todo, pool.map(lambda v: detect(v.get("website"), v.get("name")), todo)):
            if "didn't load" not in info["checked"]:      # retry next time if the site was down
                (DIR / f"{v['place_id']}.json").write_text(json.dumps(info))
            out[v["place_id"]] = info
    for v in venues:
        out[v["place_id"]] = {**out[v["place_id"]], "reservable": v.get("reservable"),
                              "phone": v.get("phone"), "website": v.get("website")}
    ailog.write("agent_step", tool="booking_lookup", sent={"venues": [v["name"] for v in venues], "fresh_checks": len(todo)},
                returned={v["name"]: {k: out[v["place_id"]][k] for k in ("platform", "checked", "reservable")} for v in venues},
                error=None)
    return out
