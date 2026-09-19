"""Harvest the official BIS standards catalogue.

Source: the public catalogue behind https://standards.bis.gov.in/website/catalogue-list
(the same data the site's own Excel export serves). Two endpoints:

    POST /proposal-service/getSectorsWithSubSectorsAndCounts   -> 215 sectors
    POST /proposal-service/getStandardsBySectorId              -> standards per sector

Every record carries the official standard number, title, publication date and
validity date. Nothing is generated here: a record either came back from BIS or
it does not exist in the output. Harvested records enter the catalogue as tier
"pending" -- a real number from the official source that no officer has
individually confirmed yet -- which is exactly what the three-tier evidence
model exists to express.

Run:  python scripts/harvest_bis.py            # writes app/data/bis_harvest.json
      python scripts/harvest_bis.py --delay 2  # slower, if the service objects
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

BASE = "https://standardsadmin.bis.gov.in/proposal-service"
OUT = Path(__file__).resolve().parents[1] / "app" / "data" / "bis_harvest.json"
HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    # Identify honestly; this is the public catalogue and a polite crawl.
    "User-Agent": "ManakSetu-catalogue-import/1.0 (SIH26108 research prototype)",
}


def post(path: str, body: dict, retries: int = 3) -> dict:
    payload = json.dumps(body).encode()
    for attempt in range(retries):
        try:
            req = urllib.request.Request(f"{BASE}/{path}", data=payload, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=90) as resp:
                return json.load(resp)
        except Exception as exc:  # noqa: BLE001 - retry then surface
            if attempt == retries - 1:
                raise
            wait = 5 * (attempt + 1)
            print(f"    retry {attempt + 1} after {exc.__class__.__name__}; sleeping {wait}s", flush=True)
            time.sleep(wait)
    raise RuntimeError("unreachable")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--delay", type=float, default=1.0, help="seconds between sector requests")
    args = parser.parse_args()

    print("Fetching sector list...", flush=True)
    sectors = post("getSectorsWithSubSectorsAndCounts", {})["data"]["sectorWise"]
    expected = sum(s.get("totalProjects") or 0 for s in sectors)
    print(f"{len(sectors)} sectors, {expected} standards expected", flush=True)

    records: dict[str, dict] = {}
    failures: list[str] = []
    for index, sector in enumerate(sectors, start=1):
        name = (sector.get("sectorName") or "").strip()
        expected_here = sector.get("totalProjects") or 0
        rows: list[dict] = []
        try:
            # The endpoint pages at 10 by default and accepts page/pageSize.
            # One oversized page usually covers a sector; the loop is for the
            # few sectors larger than the page size.
            page = 1
            while True:
                batch = post(
                    "getStandardsBySectorId",
                    {"sectorId": sector["sectorId"], "page": page, "pageSize": 500},
                ).get("data") or []
                rows.extend(batch)
                if len(batch) < 500 or len(rows) >= max(expected_here, len(rows)):
                    if len(batch) < 500:
                        break
                page += 1
                time.sleep(args.delay)
        except Exception as exc:  # noqa: BLE001 - record and continue
            failures.append(name)
            print(f"  [{index:>3}/{len(sectors)}] {name}: FAILED ({exc.__class__.__name__})", flush=True)
            time.sleep(args.delay)
            continue

        for row in rows:
            number = (row.get("standardNumber") or "").strip()
            if not number:
                continue  # no identifier, no record -- never invent one
            entry = records.setdefault(
                number,
                {
                    "standard_number": number,
                    "title": (row.get("standardName") or row.get("description") or "").strip(),
                    "published_on": row.get("publishedOn"),
                    "valid_upto": row.get("validUpto"),
                    "bis_standard_id": row.get("standardId"),
                    "sectors": [],
                    "sub_sectors": [],
                },
            )
            if name and name not in entry["sectors"]:
                entry["sectors"].append(name)
            sub = (row.get("subSectorName") or "").strip()
            if sub and sub not in entry["sub_sectors"]:
                entry["sub_sectors"].append(sub)

        print(f"  [{index:>3}/{len(sectors)}] {name}: {len(rows)} records ({len(records)} unique so far)", flush=True)
        time.sleep(args.delay)

    payload = {
        "_source": "standards.bis.gov.in public catalogue (proposal-service API)",
        "_harvested_at": datetime.now(timezone.utc).isoformat(),
        "_harvested_on": date.today().isoformat(),
        "_sectors": len(sectors),
        "_expected": expected,
        "_unique_standards": len(records),
        "_failed_sectors": failures,
        "records": sorted(records.values(), key=lambda r: r["standard_number"]),
    }
    OUT.write_text(json.dumps(payload, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {len(records)} unique standards to {OUT}", flush=True)
    if failures:
        print(f"Failed sectors ({len(failures)}): {failures}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
