"""Greenhouse — public board API. Used by Stripe, Figma, Anthropic, XTX, ..."""

from __future__ import annotations

import re

from ._base import Job, http_get

NAME = "greenhouse"

# boards.greenhouse.io/TOKEN, job-boards.greenhouse.io/TOKEN,
# boards.greenhouse.io/embed/job_board?for=TOKEN
_RE = re.compile(
    r"(?:boards|job-boards)\.greenhouse\.io/(?:embed/job_board\?for=)?([A-Za-z0-9_-]+)"
)
_SKIP = {"embed", "job_board"}


def match(url: str, html: str) -> str | None:
    for hay in (url or "", html or ""):
        m = _RE.search(hay)
        if m and m.group(1) not in _SKIP:
            return m.group(1)
    return None


def fetch(token: str) -> list[Job]:
    data = http_get(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs").json()
    jobs = []
    for j in data.get("jobs", []):
        jobs.append(Job(
            id=f"greenhouse:{j['id']}",
            title=(j.get("title") or "").strip(),
            url=j.get("absolute_url", ""),
        ))
    return jobs
