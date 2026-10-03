#!/usr/bin/env python3
"""Build the drug-register search index.

Runs at BUILD time, not at request time, and writes a compact static file that the
search route reads once and caches in module memory. Nothing here touches the database.

── why this exists instead of an import ──────────────────────────────────────────────

The bulk importer (scripts/import-egyptian-drugs.py) writes ~16,000 rows into `products`.
That was the wrong shape for what this is actually for. It makes every product list in
the application read a table it did not need to read, it commits one tenant's catalogue
choice into everyone's schema, and a sixteen-thousand-row insert into a Free-plan project
is not a thing to do casually or reverse.

So the register stays *outside* the database. This script flattens it to a static asset;
the search route filters that in memory; and only the rows a tenant actually chooses get
written, one at a time, through the same `api.create_product` the form already uses.

Search then costs a filter over an array held in memory rather than a query, and the
catalogue stays the size of the business rather than the size of the country.

── the output is arrays, not objects ─────────────────────────────────────────────────

25,000 objects with named keys is roughly double the bytes of the same data as positional
arrays, and this file is parsed once per server instance. The column order is written into
the file itself as `columns`, so the reader never hardcodes it and the two cannot drift.

── the same refusals as the importer ─────────────────────────────────────────────────

Deliberately the same rules, because a search box that offers a row the importer would
have refused is worse than no search box: it puts a banned or cancelled product in front
of a pharmacist as a suggestion. Rows the register marks CANCELLED, RECALLED, ILLEGAL
IMPORT, BANNED or UNAPPROVED are dropped, as are rows with no Arabic commercial name --
the people who need to find a medicine here are searching in Arabic.

Usage:
    scripts/build-drug-register.py [--source URL] [--out PATH] [--check]

--check verifies the built file is present and reports its shape without rewriting it,
which is what CI wants: it should fail when the asset is missing, not silently rebuild.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import sys
import urllib.request

DEFAULT_SOURCE = (
    "https://raw.githubusercontent.com/karem505/egyptian-drug-database"
    "/HEAD/data/egyptian-drugs.csv"
)

# Positional layout of each row. Order is the contract; `columns` is written alongside.
COLUMNS = [
    "nameEn",
    "nameAr",
    "generic",
    "manufacturer",
    "drugClass",
    "route",
    "priceEgp",
]

# The importer's rule, kept identical. See its header for why these exist.
BANNED_RE = re.compile(
    r"\b(ILLEGAL\s+IMPORT|ILLEGAL|CANCELLED|CANCELED|RECALLED|UNAPPROVED|BANNED"
    r"|WITHDRAWN|SUSPENDED)\b",
    re.I,
)
ARABIC_RE = re.compile(r"[\u0600-\u06FF]")
# A trade name with no letters at all -- "9999999999RR" -- is a register artefact.
JUNK_NAME_RE = re.compile(r"[A-Za-z\u0600-\u06FF]{3}")

USER_AGENT = "pharmaflow-register-build/1.0"


def parse_price(raw: str) -> float | None:
    """The register's price is a decimal string. Anything else is treated as absent.

    Returning None rather than guessing matters: a wrong reference price on a saved
    product is a number somebody will later trust, and 0 or -1 would be believed.
    """
    text = (raw or "").strip().replace(",", "")
    if not text:
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    return value if value > 0 else None


def build(source: str) -> dict:
    request = urllib.request.Request(source, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response:
        text = response.read().decode("utf-8", errors="replace")

    rows = list(csv.DictReader(io.StringIO(text)))

    entries: list[list] = []
    refused = {
        "no_name": 0,
        "no_arabic": 0,
        "junk_name": 0,
        "refused_by_register": 0,
    }

    for row in rows:
        name_en = (row.get("commercial_name_en") or "").strip()
        name_ar = (row.get("commercial_name_ar") or "").strip()
        generic = (row.get("scientific_name") or "").strip()

        if not name_en:
            refused["no_name"] += 1
            continue
        # Arabic is the point of this dataset. A row without it is a row the people who
        # need to find it cannot find.
        if not ARABIC_RE.search(name_ar):
            refused["no_arabic"] += 1
            continue
        if not JUNK_NAME_RE.search(name_ar):
            refused["junk_name"] += 1
            continue
        # Refused by the register itself. A suggestion box must not offer these.
        if BANNED_RE.search(f"{name_en} {generic}"):
            refused["refused_by_register"] += 1
            continue

        entries.append(
            [
                name_en,
                name_ar,
                generic,
                (row.get("manufacturer") or "").strip(),
                (row.get("drug_class") or "").strip(),
                (row.get("route") or "").strip(),
                parse_price(row.get("price_egp") or ""),
            ]
        )

    return {
        "columns": COLUMNS,
        "source": source,
        # Stated in the file rather than only in this script: a search result is going to
        # be shown to a person, and "where did this name come from" has to be answerable
        # without opening the repository.
        "provenance": (
            "Third-party CC0 compilation of the Egyptian drug register "
            "(karem505/egyptian-drug-database). NOT an Egyptian Drug Authority export -- "
            "the EDA publishes no public API. Reconcile against the EDA before relying on "
            "this for anything regulatory."
        ),
        "refused": refused,
        "entries": entries,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default=DEFAULT_SOURCE)
    parser.add_argument(
        "--out",
        default=os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "apps",
            "web",
            "data",
            "drug-register.json",
        ),
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify the asset exists and looks right; do not fetch or rewrite it",
    )
    args = parser.parse_args()

    if args.check:
        if not os.path.exists(args.out):
            print(f"missing: {args.out}", file=sys.stderr)
            return 1
        with open(args.out, encoding="utf-8") as handle:
            payload = json.load(handle)
        print(
            f"ok: {len(payload.get('entries', []))} entries, "
            f"columns={payload.get('columns')}, "
            f"{os.path.getsize(args.out) / 1048576:.2f} MB"
        )
        return 0

    try:
        payload = build(args.source)
    except Exception as error:  # noqa: BLE001 -- deliberate, see below
        # Fail soft, but only when there is something to fall back to.
        #
        # This runs as `prebuild`, so a fetch failure here is a *deploy* failure, and a
        # transient network blip on the build machine must not be able to take production
        # down. An asset already on disk is still valid -- it is data, and it only goes
        # stale when the register changes, which is rare. So: keep it, warn, succeed.
        if os.path.exists(args.out):
            print(
                f"warning: could not fetch the register ({error}); keeping the existing "
                f"{args.out}. It will be stale until the next successful build.",
                file=sys.stderr,
            )
            return 0
        print(
            f"error: could not fetch the register and no existing asset to fall back on: "
            f"{error}",
            file=sys.stderr,
        )
        return 1

    os.makedirs(os.path.dirname(args.out), exist_ok=True)

    # UTF-8 without ASCII escaping: these are Arabic commercial names, and \u escapes
    # would make the file roughly twice the size and unreadable in a diff.
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))

    refused = payload["refused"]
    print(
        f"built {len(payload['entries'])} entries "
        f"({os.path.getsize(args.out) / 1048576:.2f} MB) -> {args.out}"
    )
    print(
        "refused: "
        + ", ".join(f"{k}={v}" for k, v in refused.items() if v)
        + (" (none)" if not any(refused.values()) else "")
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())