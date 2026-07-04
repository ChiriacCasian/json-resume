"""Adapter layer for the job-board scraper.

A company URL is resolved to the best available source in this priority order:

  1. An explicit ``adapter`` override from companies.txt   (e.g. "greenhouse:acme")
  2. A host-specific custom adapter                        (amazon.jobs, stripe.com)
  3. An auto-detected ATS embedded in the page             (greenhouse/lever/ashby/...)
  4. The generic fallback                                  (render + fingerprint links)

Every adapter returns a list of ``Job`` objects. ``Job.id`` is a *stable*
identifier used for diffing between runs — a real ATS id where we have one,
otherwise a content hash. Titles are best-effort for the generic fallback.
"""

from __future__ import annotations

import httpx

from ._base import (  # re-exported for callers
    Job, fingerprint, http_get, http_post,
    Blocked, NotApplicable, USER_AGENT, DEFAULT_TIMEOUT,
)
from . import greenhouse, lever, ashby, smartrecruiters, workday
from . import custom_amazon, custom_stripe, generic

# ATS auto-detectors, tried in order. Each exposes NAME, match(url, html) -> token|None
# and fetch(token) -> list[Job].
ATS_MODULES = [greenhouse, lever, ashby, smartrecruiters, workday]

# Host-specific custom adapters, matched before generic ATS detection.
CUSTOM_BY_HOST = {
    "amazon.jobs": custom_amazon,
    "www.amazon.jobs": custom_amazon,
    "stripe.com": custom_stripe,
    "www.stripe.com": custom_stripe,
}

# Adapters addressable by name from an `adapter` override.
BY_NAME = {
    "greenhouse": greenhouse,
    "lever": lever,
    "ashby": ashby,
    "smartrecruiters": smartrecruiters,
    "workday": workday,
    "amazon": custom_amazon,
    "stripe": custom_stripe,
    "generic": generic,
}


def resolve(entry: dict) -> tuple[str, list[Job]]:
    """Resolve a watchlist entry to (source_label, jobs).

    Raises Blocked / network errors to the caller, which records the failure
    without losing prior state.
    """
    url = entry["url"]
    override = entry.get("adapter")

    # 1. Explicit override, optionally "name:token" (e.g. "greenhouse:xtxmarketstechnologies").
    if override:
        name, _, token = override.partition(":")
        mod = BY_NAME.get(name)
        if not mod:
            raise ValueError(f"Unknown adapter override: {override!r}")
        if hasattr(mod, "fetch"):  # an ATS module
            token = token or (mod.match(url, "") or "")
            if not token:
                raise ValueError(f"Adapter {name!r} needs a token: use '{name}:<token>'")
            return f"{name}:{token}", mod.fetch(token)
        return mod.collect(url, entry)  # collect-style (custom / generic)

    host = httpx.URL(url).host or ""

    # 2. Host-specific custom adapter.
    custom = CUSTOM_BY_HOST.get(host)
    if custom:
        try:
            return custom.collect(url, entry)
        except NotApplicable:
            pass  # e.g. an amazon.jobs content page with no searchable listing -> generic

    # 3. Auto-detect an embedded ATS from the page HTML.
    html, detection_blocked = "", False
    try:
        html = http_get(url).text
    except Blocked:
        detection_blocked = True  # try the real browser before giving up
    except Exception:
        pass  # detection just won't fire; generic will try with a browser

    for mod in ATS_MODULES:
        token = mod.match(url, html)
        if token:
            try:
                label_fn = getattr(mod, "label", None)
                label = label_fn(token) if label_fn else f"{mod.NAME}:{token}"
                return label, mod.fetch(token)
            except Exception:
                break  # a bad ATS guess must not error the company -> generic

    # 4. Generic fallback (headless render + JSON sniff).
    label, jobs = generic.collect(url, entry, html=html)
    if not jobs and detection_blocked:
        raise Blocked(f"blocked and no jobs via browser: {url}")
    return label, jobs
