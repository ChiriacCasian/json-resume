"""SmartRecruiters — public postings API. Used by many large EU employers."""

from __future__ import annotations

import re

from ._base import Job, http_get

NAME = "smartrecruiters"

_RE = re.compile(r"(?:careers|jobs)\.smartrecruiters\.com/([A-Za-z0-9_-]+)")


def match(url: str, html: str) -> str | None:
    for hay in (url or "", html or ""):
        m = _RE.search(hay)
        if m:
            return m.group(1)
    return None


def fetch(token: str) -> list[Job]:
    jobs, offset = [], 0
    while offset <= 2000:
        data = http_get(
            f"https://api.smartrecruiters.com/v1/companies/{token}/postings"
            f"?limit=100&offset={offset}"
        ).json()
        content = data.get("content", [])
        for j in content:
            jid = j.get("id")
            jobs.append(Job(
                id=f"smartrecruiters:{jid}",
                title=(j.get("name") or "").strip(),
                url=f"https://jobs.smartrecruiters.com/{token}/{jid}",
            ))
        offset += 100
        if not content or offset >= data.get("totalFound", 0):
            break
    return jobs
