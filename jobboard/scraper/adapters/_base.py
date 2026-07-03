"""Shared primitives for all adapters (kept separate to avoid import cycles)."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, asdict

import httpx

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"
)
DEFAULT_TIMEOUT = 25.0


class Blocked(Exception):
    """Site actively blocked us (403/429/captcha). Caller preserves prior state."""


class NotApplicable(Exception):
    """Adapter does not fit this URL after all -> fall through to the next option."""


@dataclass
class Job:
    id: str          # stable identifier used for diffing between runs
    title: str
    url: str

    def to_item(self, first_seen: str) -> dict:
        d = asdict(self)
        d["firstSeen"] = first_seen
        return d


def fingerprint(*parts: str) -> str:
    """Short stable hash used as a job id when no real ATS id is available."""
    raw = "|".join((p or "").strip().lower() for p in parts)
    return "h:" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def _check(resp: httpx.Response) -> httpx.Response:
    if resp.status_code in (403, 429):
        raise Blocked(f"{resp.status_code} for {resp.request.url}")
    resp.raise_for_status()
    return resp


def http_get(url: str, **kwargs) -> httpx.Response:
    headers = {"User-Agent": USER_AGENT, "Accept": "*/*", **kwargs.pop("headers", {})}
    return _check(httpx.get(
        url, headers=headers,
        timeout=kwargs.pop("timeout", DEFAULT_TIMEOUT),
        follow_redirects=True, **kwargs,
    ))


def http_post(url: str, **kwargs) -> httpx.Response:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Content-Type": "application/json",
        **kwargs.pop("headers", {}),
    }
    return _check(httpx.post(
        url, headers=headers,
        timeout=kwargs.pop("timeout", DEFAULT_TIMEOUT),
        follow_redirects=True, **kwargs,
    ))
