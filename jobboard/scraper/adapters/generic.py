"""Generic fallback that works for (almost) any career site.

Modern career pages are SPAs that load their listings as JSON over XHR/fetch.
So rather than scrape fragile rendered markup, we drive the page with a headless
browser and *capture the JSON responses it makes*, then harvest job-like records
from them. This one technique covers Google, Meta, Uber, Netflix (Eightfold),
Amazon and most others without per-site code.

Fallback ladder:
  1. Render + sniff XHR/fetch JSON  -> harvest records with a title + id/url
  2. Extract <a href> job links from the rendered DOM
  3. Extract <a href> job links from the static HTML we already had

Reliably answers "did anything change?"; exact titles are best-effort.
If Playwright isn't installed, only steps 2-3 (static) run.
"""

from __future__ import annotations

import re
from urllib.parse import urljoin, urlparse

from ._base import Job, fingerprint, http_get, USER_AGENT

NAME = "generic"

# ---- JSON harvesting -------------------------------------------------------

_TITLE_KEYS = (
    "title", "text", "name", "jobTitle", "job_title", "positionName",
    "displayName", "position_title", "postingName",
)
_ID_KEYS = (
    "id", "jobId", "job_id", "reqId", "req_id", "requisitionId", "slug",
    "ref", "externalPath", "job_number", "displayJobId", "canonicalPositionUrl",
    "absolute_url", "pid",
)
_URL_KEYS = (
    "url", "jobUrl", "hostedUrl", "absolute_url", "applyUrl", "apply_url",
    "canonicalPositionUrl", "job_path", "externalPath", "positionUrl",
    "detailUrl",
)
_MAX_JOBS = 600


def _record_to_job(node: dict, base_url: str) -> Job | None:
    title = next(
        (node[k].strip() for k in _TITLE_KEYS
         if isinstance(node.get(k), str) and node[k].strip()),
        None,
    )
    if not title or not (3 <= len(title) <= 140):
        return None
    idv = next((str(node[k]) for k in _ID_KEYS if node.get(k) not in (None, "")), None)
    urlv = next(
        (urljoin(base_url, node[k]) for k in _URL_KEYS
         if isinstance(node.get(k), str) and node[k]),
        None,
    )
    if not idv and not urlv:
        return None  # a bare {name: ...} is probably a filter facet, not a job
    key = fingerprint(title, idv or urlv)
    return Job(id=key, title=title, url=urlv or base_url)


def _harvest_json(payloads: list, base_url: str) -> list[Job]:
    jobs: dict[str, Job] = {}

    def walk(node):
        if len(jobs) >= _MAX_JOBS:
            return
        if isinstance(node, dict):
            job = _record_to_job(node, base_url)
            if job:
                jobs[job.id] = job
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    for pl in payloads:
        try:
            walk(pl)
        except Exception:
            continue
    return list(jobs.values())


# ---- rendered / static link extraction -------------------------------------

_HINTS = (
    "/job", "/jobs/", "/careers/", "/career/", "/position", "/opening",
    "/vacan", "/role", "gh_jid", "/apply", "/listing", "/posting",
)
# Exact nav/section labels that live under /careers/ but aren't jobs.
_NOISE_EXACT = {
    "privacy", "cookie", "cookies", "terms", "login", "log in", "sign in",
    "sign up", "contact", "about", "about us", "home", "apply now", "careers",
    "learn more", "read more", "view all", "see all", "all jobs", "saved jobs",
    "all openings", "search jobs", "back", "next", "previous", "here",
    "open jobs", "open positions", "open roles", "culture", "benefits",
    "perks", "perks & benefits", "engineering", "go to market", "sales",
    "our teams", "teams", "locations", "students", "graduates",
    "students & graduates", "early careers", "university recruiting",
    "internships", "internships & early careers", "how we hire",
    "hiring process", "interviewing with us", "interview prep", "faq",
    "diversity", "diversity & inclusion", "life at", "our culture",
    "recruitment fraud", "talent community", "join our talent community",
    "career areas", "job alerts", "meet the team", "why join", "values",
}

# Substrings that appear only in footer/legal/nav/UI chrome, never in a job title.
_NOISE_SUBSTR = (
    "privacy", "cookie", "do not sell", "personal information",
    "similar technolog", "all rights reserved", "view all job", "saved job",
    "terms of", "manage preferences", "life at", "getting hired",
    "students and early", "students & early", "contractor opportunit",
    "meet our", "our story", "why join", "how we hire", "learn more",
)

# URL fragments that mark a link as a legal/privacy page, not a posting.
_NOISE_URL = (
    "privacy", "cookie", "candidateprivacy", "/legal", "gdpr",
    "/terms", "/press", "do-not-sell",
)


def _is_noise(text: str) -> bool:
    low = text.lower()
    return low in _NOISE_EXACT or any(s in low for s in _NOISE_SUBSTR)


def _extract_links(base_url: str, html: str) -> list[Job]:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    out: dict[str, Job] = {}
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if not any(h in href.lower() for h in _HINTS):
            continue
        absu = urljoin(base_url, href)
        if any(s in absu.lower() for s in _NOISE_URL):
            continue
        text = " ".join(re.sub(r"[→↳›»‹«]", "", a.get_text(" ")).split())
        if not (4 <= len(text) <= 120) or _is_noise(text):
            continue
        path = urlparse(absu).path
        key = fingerprint(text, path)
        out[key] = Job(id=key, title=text, url=absu)
    return list(out.values())


def _render_and_capture(url: str) -> tuple[str | None, list]:
    """Return (rendered_html, captured_json_payloads). ([]/None if no browser)."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return None, []

    payloads: list = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--no-sandbox"])
            page = browser.new_page(user_agent=USER_AGENT)

            def on_response(resp):
                try:
                    if resp.request.resource_type not in ("xhr", "fetch"):
                        return
                    if "json" not in resp.headers.get("content-type", "").lower():
                        return
                    payloads.append(resp.json())
                except Exception:
                    pass

            page.on("response", on_response)
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(4000)  # let listing XHRs fire
            html = page.content()
            browser.close()
            return html, payloads
    except Exception:
        return None, payloads


# Above this, a sniffed JSON feed is assumed to be the site's *whole* catalog
# (client-side filtered), not the user's filtered view -> prefer the DOM instead.
_API_FILTER_CEILING = 150


def collect(url: str, entry: dict, html: str | None = None) -> tuple[str, list[Job]]:
    rendered, payloads = _render_and_capture(url)

    api_jobs = _harvest_json(payloads, url)
    dom_jobs = _extract_links(url, rendered) if rendered else []

    # A focused API feed is the best signal: real titles + stable ids, and small
    # enough that it reflects the page's filter rather than the full catalog.
    if 3 <= len(api_jobs) <= _API_FILTER_CEILING:
        return "generic:api", api_jobs

    # Otherwise trust what the filtered page actually renders (even a few roles)
    # rather than a large, likely-unfiltered API dump.
    if dom_jobs:
        return "generic:dom", dom_jobs

    # Last resorts: the large API feed, then static HTML.
    if api_jobs:
        return "generic:api", api_jobs

    if html is None:
        try:
            html = http_get(url).text
        except Exception:
            html = ""
    return "generic:static", _extract_links(url, html or "")
