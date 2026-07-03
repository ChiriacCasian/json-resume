"""Stripe — parse /jobs/listing/<slug>/<id> links out of the careers HTML.

Stripe renders its listing links server-side, so a plain fetch is enough. Each
listing carries a stable numeric id we use for diffing. If the HTML has no
listings (layout change / full client render), fall through to generic.
"""

from __future__ import annotations

import re

from ._base import Job, http_get, NotApplicable

NAME = "stripe"

_LISTING = re.compile(r"/jobs/listing/([a-z0-9-]+)/(\d+)")


def collect(url: str, entry: dict, html: str | None = None) -> tuple[str, list[Job]]:
    if html is None:
        html = http_get(url).text

    found: dict[str, str] = {}
    for m in _LISTING.finditer(html):
        slug, jid = m.group(1), m.group(2)
        found.setdefault(jid, slug)

    if not found:
        raise NotApplicable("no stripe listings found in HTML")

    jobs = [
        Job(
            id=f"stripe:{jid}",
            title=slug.replace("-", " ").title(),
            url=f"https://stripe.com/jobs/listing/{slug}/{jid}",
        )
        for jid, slug in found.items()
    ]
    return "stripe:jobs", jobs
