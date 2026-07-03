"""Ashby — public job-board API. Used by Notion, Linear, Ramp, ..."""

from __future__ import annotations

import re

from ._base import Job, http_get

NAME = "ashby"

_RE = re.compile(r"jobs\.ashbyhq\.com/([A-Za-z0-9_.-]+)")


def match(url: str, html: str) -> str | None:
    for hay in (url or "", html or ""):
        m = _RE.search(hay)
        if m:
            return m.group(1).rstrip("/")
    return None


def fetch(token: str) -> list[Job]:
    url = f"https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=false"
    data = http_get(url).json()
    jobs = []
    for j in data.get("jobs", []):
        jobs.append(Job(
            id=f"ashby:{j.get('id')}",
            title=(j.get("title") or "").strip(),
            url=j.get("jobUrl") or j.get("applyUrl", ""),
        ))
    return jobs
