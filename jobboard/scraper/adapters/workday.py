"""Workday — cxs jobs endpoint. Best-effort: tenant/site parsed from the URL."""

from __future__ import annotations

import re

import httpx

from ._base import Job, http_post

NAME = "workday"

_LANG = re.compile(r"^[a-z]{2}([-_][A-Za-z]{2})?$")
_URL_IN_HTML = re.compile(r"https://[a-z0-9-]+\.[a-z0-9]+\.myworkdayjobs\.com/[^\s\"'<>]+")


def match(url: str, html: str) -> str | None:
    # For Workday the "token" is the full careers URL (we parse tenant/site from it).
    if "myworkdayjobs.com" in (url or ""):
        return url
    if html:
        m = _URL_IN_HTML.search(html)
        if m:
            return m.group(0)
    return None


def fetch(token: str) -> list[Job]:
    u = httpx.URL(token)
    host = u.host                       # {tenant}.{dc}.myworkdayjobs.com
    tenant = host.split(".")[0]
    segments = [p for p in u.path.split("/") if p]
    site = next((p for p in reversed(segments) if not _LANG.match(p)), None)
    if not site:
        return []

    api = f"https://{host}/wday/cxs/{tenant}/{site}/jobs"
    jobs, offset = [], 0
    while offset <= 400:
        data = http_post(api, json={"limit": 20, "offset": offset, "searchText": ""}).json()
        postings = data.get("jobPostings", [])
        for j in postings:
            path = j.get("externalPath", "")
            jobs.append(Job(
                id=f"workday:{path}",
                title=(j.get("title") or "").strip(),
                url=f"https://{host}{path}",
            ))
        offset += 20
        if not postings or offset >= data.get("total", 0):
            break
    return jobs
