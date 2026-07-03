"""Lever — public postings API. Used by Netflix, Spotify, ..."""

from __future__ import annotations

import re

from ._base import Job, http_get

NAME = "lever"

_RE = re.compile(r"jobs(?:\.eu)?\.lever\.co/([A-Za-z0-9_-]+)")


def match(url: str, html: str) -> str | None:
    for hay in (url or "", html or ""):
        m = _RE.search(hay)
        if m:
            return m.group(1)
    return None


def fetch(token: str) -> list[Job]:
    data = http_get(f"https://api.lever.co/v0/postings/{token}?mode=json").json()
    jobs = []
    for j in data:
        jobs.append(Job(
            id=f"lever:{j['id']}",
            title=(j.get("text") or "").strip(),
            url=j.get("hostedUrl", ""),
        ))
    return jobs
