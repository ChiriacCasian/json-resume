#!/usr/bin/env python3
"""Job-board scraper.

Reads the watchlist (jobboard/companies.txt), scrapes each company, diffs the
current openings against the previous run, and writes jobboard/state.json.

State is the persistence layer: it is committed back to the repo by the daily
GitHub Action, so git history doubles as an audit log of when each role appeared.

Local:   python jobboard/scraper/scrape.py
CI:       sets GITHUB_OUTPUT (has_new, body) for the email step.
"""

from __future__ import annotations

import datetime
import json
import os
import re
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from adapters import resolve, Blocked  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]  # jobboard/
TXT_IN = ROOT / "companies.txt"
JSON_IN = ROOT / "companies.json"
STATE = ROOT / "state.json"
RECENT_DAYS = 14
NEW_ITEMS_CAP = 25  # per company, in the email summary


def now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()


def today() -> str:
    return datetime.date.today().isoformat()


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "company"


def derive_name(url: str) -> str:
    host = httpx.URL(url).host or url
    return re.sub(r"^www\.", "", host)


# ---------------------------------------------------------------- watchlist ---

def _mk_entry(name: str | None, url: str, adapter: str | None) -> dict:
    name = name or derive_name(url)
    entry = {"id": slugify(name), "name": name, "url": url}
    if adapter:
        entry["adapter"] = adapter
    return entry


def load_watchlist() -> list[dict]:
    """companies.txt (preferred) or companies.json (fallback).

    companies.txt line formats (fastest first):
        https://example.com/careers
        Display Name | https://example.com/careers
        Display Name | https://example.com/careers | greenhouse:token
    Blank lines and #-comments are ignored.
    """
    raw_entries: list[dict] = []
    if TXT_IN.exists():
        for line in TXT_IN.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = [p.strip() for p in line.split("|")]
            if len(parts) == 1:
                raw_entries.append(_mk_entry(None, parts[0], None))
            elif len(parts) == 2:
                raw_entries.append(_mk_entry(parts[0], parts[1], None))
            else:
                raw_entries.append(_mk_entry(parts[0], parts[1], parts[2] or None))
    elif JSON_IN.exists():
        for item in json.loads(JSON_IN.read_text(encoding="utf-8")):
            if isinstance(item, str):
                raw_entries.append(_mk_entry(None, item, None))
            else:
                raw_entries.append(_mk_entry(item.get("name"), item["url"], item.get("adapter")))

    # Ensure ids are unique so companies never collide in state.json.
    seen: dict[str, int] = {}
    for e in raw_entries:
        base = e["id"]
        if base in seen:
            seen[base] += 1
            e["id"] = f"{base}-{seen[base]}"
        else:
            seen[base] = 1
    return raw_entries


# -------------------------------------------------------------------- state ---

def load_prev() -> dict[str, dict]:
    if not STATE.exists():
        return {}
    try:
        data = json.loads(STATE.read_text(encoding="utf-8"))
        return {c["id"]: c for c in data.get("companies", [])}
    except Exception:
        return {}


def merge_recent(prev: dict | None, new_jobs: list, today_str: str) -> list[dict]:
    items: dict[str, dict] = {}
    if prev:
        cutoff = (datetime.date.today() - datetime.timedelta(days=RECENT_DAYS)).isoformat()
        for it in prev.get("recentItems", []):
            if it.get("firstSeen", "") >= cutoff:
                items[it["id"]] = it
    for j in new_jobs:
        items[j.id] = j.to_item(today_str)
    return sorted(items.values(), key=lambda x: x.get("firstSeen", ""), reverse=True)


def _preserve(res: dict, prev: dict | None, status: str, msg: str) -> None:
    """A failed check must not wipe state or emit false new/removed items."""
    res["status"] = status
    res["error"] = msg
    res["newItems"] = []
    if prev:
        res["source"] = prev.get("source")
        res["knownIds"] = prev.get("knownIds", [])
        res["totalOpen"] = prev.get("totalOpen", 0)
        res["recentItems"] = prev.get("recentItems", [])


def process(entry: dict, prev_map: dict[str, dict]) -> dict:
    prev = prev_map.get(entry["id"])
    res = {
        "id": entry["id"], "name": entry["name"], "url": entry["url"],
        "source": None, "status": "ok", "lastCheckedAt": now(),
        "totalOpen": 0, "knownIds": [], "recentItems": [], "newItems": [],
    }
    try:
        source, jobs = resolve(entry)
        res["source"] = source
        cur_ids = [j.id for j in jobs]
        if prev is None:
            new_jobs = []  # first sighting: seed the baseline silently
        else:
            known = set(prev.get("knownIds", []))
            new_jobs = [j for j in jobs if j.id not in known]
        res["totalOpen"] = len(jobs)
        res["knownIds"] = cur_ids
        res["newItems"] = [j.to_item(today()) for j in new_jobs]
        res["recentItems"] = merge_recent(prev, new_jobs, today())
    except Blocked as e:
        _preserve(res, prev, "blocked", str(e))
    except Exception as e:
        _preserve(res, prev, "error", str(e))
    return res


# ------------------------------------------------------------------ outputs ---

def build_summary(new_companies: list[dict]) -> str:
    lines = []
    for c in new_companies:
        lines.append(f"## {c['name']} — {len(c['newItems'])} new")
        for it in c["newItems"][:NEW_ITEMS_CAP]:
            lines.append(f"- {it['title']}\n  {it['url']}")
        extra = len(c["newItems"]) - NEW_ITEMS_CAP
        if extra > 0:
            lines.append(f"- …and {extra} more")
        lines.append("")
    return "\n".join(lines).strip()


def emit_ci(has_new: bool, summary: str) -> None:
    gh_out = os.environ.get("GITHUB_OUTPUT")
    if not gh_out:
        return
    with open(gh_out, "a", encoding="utf-8") as f:
        f.write(f"has_new={'true' if has_new else 'false'}\n")
        f.write("body<<JOBEOF\n")
        f.write((summary or "No new postings.") + "\n")
        f.write("JOBEOF\n")


def main() -> None:
    entries = load_watchlist()
    if not entries:
        print("No companies in watchlist (jobboard/companies.txt). Nothing to do.")
        return
    prev_map = load_prev()

    companies = []
    for e in entries:
        print(f"[{e['id']}] {e['url']}")
        c = process(e, prev_map)
        note = f" ({c['error']})" if c.get("error") else ""
        print(f"    -> source={c['source']} status={c['status']} "
              f"open={c['totalOpen']} new={len(c['newItems'])}{note}")
        companies.append(c)

    out = {"generatedAt": now(), "companies": companies}
    STATE.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    new_companies = [c for c in companies if c["newItems"]]
    total_new = sum(len(c["newItems"]) for c in companies)
    summary = build_summary(new_companies)
    print("\n" + (summary if total_new else "No new postings this run."))
    emit_ci(total_new > 0, summary)


if __name__ == "__main__":
    main()
