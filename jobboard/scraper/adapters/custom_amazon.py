"""Amazon — undocumented amazon.jobs/search.json. Best-effort.

Only the *search* surface is machine-readable. Content/program pages (e.g. the
EU student-internship landing page) carry no listing feed, so we raise
NotApplicable and let the generic renderer fingerprint the page instead.
"""

from __future__ import annotations

from ._base import Job, http_get, NotApplicable

NAME = "amazon"

# search.json keys we forward straight from the incoming URL's query string.
_PASSTHROUGH = {
    "base_query", "category", "schedule_type_id", "normalized_country_code",
    "city", "region", "county", "business_category", "loc_query",
}


def collect(url: str, entry: dict, html: str | None = None) -> tuple[str, list[Job]]:
    from httpx import URL
    parsed = URL(url)
    is_search = "/search" in parsed.path or bool(parsed.params)
    if not is_search:
        raise NotApplicable("amazon.jobs content page has no listing feed")

    base = {k: v for k, v in parsed.params.multi_items() if k in _PASSTHROUGH}
    jobs, offset = [], 0
    while offset <= 500:
        params = {**base, "result_limit": 100, "offset": offset, "sort": "recent"}
        data = http_get("https://www.amazon.jobs/en/search.json", params=params).json()
        hits = data.get("jobs", [])
        for j in hits:
            jid = j.get("id_icims") or j.get("id")
            jobs.append(Job(
                id=f"amazon:{jid}",
                title=(j.get("title") or "").strip(),
                url=f"https://www.amazon.jobs{j.get('job_path', '')}",
            ))
        offset += 100
        if not hits or offset >= data.get("hits", 0):
            break

    if not jobs:
        raise NotApplicable("amazon.jobs search returned nothing")
    return "amazon:search", jobs
