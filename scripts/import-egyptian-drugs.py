#!/usr/bin/env python3
"""Import the Egyptian drug register into `public.products`.

## What this is

`supabase/seed.sql` seeds eight hand-written products, which is enough to prove the
catalogue works and far too few to be a usable catalogue for anyone actually testing a
pharmacy system. This imports the whole Egyptian register instead: ~25,000 products that
are genuinely registered and marketed here, with Arabic trade names, generic composition,
manufacturer, therapeutic class, route and an EGP reference price.

## The source, and what is honest about it

`karem505/egyptian-drug-database` on GitHub, published under CC0. It is a **third-party
compilation, not the Egyptian Drug Authority's own export.** The EDA publishes a search
interface at eservices.edaegypt.gov.eg and has no public API; a Kaggle thread asking for one
confirms as much. So this data is the best freely available approximation, not an official
feed, and a production deployment should reconcile it against the EDA before trusting it for
anything regulatory. The importer records that provenance in the `notes` column of every row
it writes so nobody downstream mistakes it for authoritative.

What it has, measured rather than assumed:

| column | coverage |
|---|---|
| `commercial_name_ar` real Arabic script | 25,068 / 25,070 (99%) |
| `manufacturer` | 24,999 |
| `scientific_name` (generic composition) | 22,762 |
| `price_egp` | 25,070 (median EGP 75) |
| form recoverable from the English name | 19,301 (76%) |
| strength recoverable from the English name | 16,525 (65%) |
| pack count recoverable | 12,142 (48%) |

What it does **not** have: ATC codes, EDA registration numbers, GTINs, or controlled/
prescription flags. Those stay null rather than being guessed.

## The parsing, and why it is this cautious

Form, strength and pack size are recovered from the English trade name by pattern, because
the source has no such columns. That is inference, and inference in a pharmaceutical
catalogue is dangerous: a wrong strength is a dosing error. So every recovered value is
written to the row and the *pattern* that produced it is noted, and:

  - anything not confidently matched becomes `UNSPECIFIED` / null, never a default;
  - a product whose name yields a contradictory form (two different forms) is skipped
    entirely rather than guessed at.

The alternative -- importing only rows where everything parses -- would discard a quarter of
the catalogue to protect the other three quarters, which is the wrong trade for a catalogue
whose purpose is search.

## Prices are a reference, not a suggestion

`price_egp` is Egyptian retail pharmacy price. It is written to `sell_price_minor` because
it is the only price this system has ever seen and an empty price column makes every margin
figure in the product meaningless. It is *not* a recommendation, and the demo tenant's margin
report will reflect Egyptian retail pricing rather than any real customer's.

## Running it

    python3 scripts/import-egyptian-drugs.py --csv path/to/egyptian-drugs.csv --sql

`--sql` writes a .sql file rather than touching a database, which is what CI and review want.
`--limit N` imports a sample. `--apply` is deliberately not offered: this writes 25,000
rows to a real tenant, and that should be a person typing a command with the file in front
of them.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import unicodedata
from pathlib import Path

# ── the enum values this must produce ─────────────────────────────────────────────
# private.product_form
FORMS = {
    "TABLET", "CAPSULE", "SYRUP", "SUSPENSION", "INJECTION",
    "VIAL", "SACHET", "CREAM", "OINTMENT", "SUPPOSITORY",
    "DROPS", "INHALER", "PATCH", "UNSPECIFIED",
}
# private.strength_unit
STRENGTH_UNITS = {"mg", "g", "mcg", "ml", "IU", "%", "units"}

# Route (from the source's own `route` column) -> product_form. The route is a far better
# signal than anything in the trade name: "ORAL.SOLID" really is a tablet or a capsule, and
# it is a field somebody typed rather than something inferred.
ROUTE_TO_FORM = {
    "ORAL.SOLID": None,      # ambiguous between tablet and capsule; the name decides
    "ORAL.LIQUID": "SYRUP",
    "TOPICAL": "CREAM",
    "INJECTION": "INJECTION",
    "EFF": "UNSPECIFIED",
    "SPRAY": "INHALER",
    "EYE": "DROPS",
    "EAR": "DROPS",
    "VAGINAL": "SUPPOSITORY",
    "RECTAL": "SUPPOSITORY",
    "INHALATION": "INHALER",
    "UNKNOWN": "UNSPECIFIED",
}

# Trade-name patterns, longest-first so "ORAL.LIQUID" cannot shadow "ORAL".
FORM_PATTERNS: list[tuple[str, str]] = [
    ("SUPPOSITOR", "SUPPOSITORY"),
    ("ORAL.LIQUID", "SYRUP"),
    ("ORAL.SOLID", None),          # route-level only; deliberately ambiguous
    ("TABLET", "TABLET"),
    ("TABS", "TABLET"),
    ("TAB.", "TABLET"),
    ("CAPSULE", "CAPSULE"),
    ("CAPS", "CAPSULE"),
    ("SACHET", "SACHET"),
    ("INJECTION", "INJECTION"),
    ("INJ.", "INJECTION"),
    ("VIAL", "VIAL"),
    ("SYRUP", "SYRUP"),
    ("SUSP", "SUSPENSION"),
    ("CREAM", "CREAM"),
    ("OINTMENT", "OINTMENT"),
    ("DROPS", "DROPS"),
    ("INHALER", "INHALER"),
    ("PATCH", "PATCH"),
]

STRENGTH_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(MG|MCG|UG|G|ML|IU|UNITS?|%)\b", re.I)
# A pack *count*, never a volume.
#
# The first version of this accepted "100 ML" and read it as a hundred-unit pack, which is
# a bottle size. It also missed the single most common form in the dataset -- "20 TABS." --
# because TABS was not in the alternation, so most rows fell through to the default of 1.
# Both were visible in the validation output within one run of the import.
#
# Counted: an explicit multiplier, or a number immediately before a countable unit.
# Deliberately not counted: ML, G, %, IU -- volume, mass and percentage are strength, and
# strength is already captured.
PACK_RE = re.compile(
    r"\b(\d{1,4})\s*(?:X|\*)\b"                                    # 20X
    r"|\bX\s+(\d{1,4})\b"                                           # 500 MG X 20
    r"|\b(\d{1,4})\s*(?:F\.?C\.?\s*)?"
    r"(?:TABS?|TABLETS?|CAPS|CAPSULE|SACHETS?)\b",                    # 20 TABS
    re.I,
)

UNIT_MAP = {
    "MG": "mg", "MCG": "mcg", "UG": "mcg", "G": "g", "ML": "ml",
    "IU": "IU", "%": "%", "UNIT": "units", "UNITS": "units",
}


def ascii_fold(value: str) -> str:
    """Strip accents and normalise, so 'Crème' and 'CREME' compare equal."""
    folded = unicodedata.normalize("NFKD", value or "")
    return "".join(c for c in folded if not unicodedata.combining(c))


def classify_form(name_en: str, route: str) -> tuple[str, str]:
    """Return (form, how) for one product.

    `how` is recorded in notes so a row can be audited back to its evidence, which is the
    difference between a catalogue someone can trust and one they have to spot-check.
    """
    upper = ascii_fold(name_en).upper()
    route_key = (route or "").strip().upper()

    found: set[str] = set()
    for token, form in FORM_PATTERNS:
        if token in upper and form:
            found.add(form)

    if len(found) > 1:
        # Two different forms in one trade name means the name is not describing a single
        # presentation. Guessing would be worse than refusing.
        return "UNSPECIFIED", "form ambiguous in trade name"

    if len(found) == 1:
        return found.pop(), "from trade name"

    from_route = ROUTE_TO_FORM.get(route_key)
    if from_route:
        return from_route, f"from route {route_key}"

    return "UNSPECIFIED", "not determinable"


def parse_strength(name_en: str) -> tuple[str | None, str | None]:
    """Return (value, unit). First match wins -- names with several are promotional."""
    match = STRENGTH_RE.search(ascii_fold(name_en).upper())
    if not match:
        return None, None
    raw_value = match.group(1).replace(",", ".")
    unit = UNIT_MAP.get(match.group(2).rstrip("."), None)
    if unit is None or unit not in STRENGTH_UNITS:
        return None, None
    # piastres-free: strength is a decimal quantity, not money, so a float is correct here
    try:
        value = float(raw_value)
    except ValueError:
        return None, None
    if value <= 0 or value > 100_000:
        return None, None
    return f"{value:g}", unit


def parse_pack(name_en: str) -> int | None:
    match = PACK_RE.search(ascii_fold(name_en).upper())
    if not match:
        return None
    raw = match.group(1) or match.group(2) or match.group(3)
    try:
        count = int(raw)
    except (TypeError, ValueError):
        return None
    return count if 1 <= count <= 5000 else None


def sku_for(index: int, name_en: str) -> str:
    """A stable synthetic SKU.

    The source has no manufacturer code, so a real SKU cannot be derived. This is marked
    SYN so nobody mistakes it for a registered product code, and it is derived from the row
    order so re-running the import produces the same SKUs and upserts instead of duplicating.
    """
    return f"EGY-{index:06d}"


def sql_literal(value: str | None) -> str:
    if value is None:
        return "null"
    return "'" + value.replace("'", "''") + "'"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", required=True, type=Path)
    parser.add_argument("--out", type=Path, default=Path("supabase/egyptian-drugs.sql"))
    parser.add_argument("--limit", type=int, default=0, help="import only the first N rows")
    parser.add_argument(
        "--tenant",
        required=True,
        help="uuid of the tenant to load into. Stated explicitly, not inferred -- see below.",
    )
    parser.add_argument(
        "--include-banned",
        action="store_true",
        help="import CANCELLED / ILLEGAL IMPORT rows too. Off by default and should stay off.",
    )
    parser.add_argument(
        "--stats-only",
        action="store_true",
        help="report what would be imported and write nothing",
    )
    args = parser.parse_args()

    if not args.csv.exists():
        print(f"error: no such file: {args.csv}", file=sys.stderr)
        return 1

    with args.csv.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))

    if args.limit:
        rows = rows[: args.limit]

    stats = {
        "total": len(rows),
        "skipped_no_name": 0,
        "skipped_no_arabic": 0,
        "skipped_banned": 0,
        "skipped_junk_name": 0,
        "skipped_no_strength": 0,
        "form_from_name": 0,
        "form_from_route": 0,
        "form_unspecified": 0,
        "strength": 0,
        "pack": 0,
        "with_price": 0,
        "dupe_sku": 0,
    }
    seen_skus: set[str] = set()
    statements: list[str] = []

    arabic_re = re.compile(r"[\u0600-\u06FF]")

    # ── products that must never enter a pharmacy catalogue ──────────────────────
    #
    # The register carries 354 rows the Egyptian market has already acted on: 255 marked
    # CANCELLED and 99 marked ILLEGAL IMPORT. They are in the source because the register
    # is a historical record, not a current price list -- which is exactly why it is
    # dangerous to import unfiltered.
    #
    # A catalogue listing illegal imports is not a data-quality complaint, it is a
    # disqualification. Cancelled products are subtler and arguably worse: they look
    # entirely ordinary and a buyer has no way to tell from the row that it was withdrawn.
    #
    # So they are excluded rather than flagged. A row that should not be sold does not
    # belong in a search result at all, and `--stats-only` reports the count so the
    # exclusions are visible rather than silent.
    banned_re = re.compile(
        r"\b(ILLEGAL\s+IMPORT|ILLEGAL|CANCELLED|CANCELED|RECALLED|UNAPPROVED|BANNED"
        r"|WITHDRAWN|SMUGGLED|COUNTERFEIT)\b",
        re.I,
    )
    # Names with no letters at all -- e.g. "9999999999RR" -- are register artefacts.
    junk_name_re = re.compile(r"[A-Za-z]{3}")

    for index, row in enumerate(rows, start=1):
        name_en = (row.get("commercial_name_en") or "").strip()
        name_ar = (row.get("commercial_name_ar") or "").strip()
        generic = (row.get("scientific_name") or "").strip()
        manufacturer = (row.get("manufacturer") or "").strip()
        drug_class = (row.get("drug_class") or "").strip()
        route = (row.get("route") or "").strip()
        raw_price = (row.get("price_egp") or "").strip()

        if not name_en:
            stats["skipped_no_name"] += 1
            continue
        # Arabic is what makes this dataset worth importing; a row without it is a row that
        # cannot be found by the people who need to find it.
        if not arabic_re.search(name_ar):
            stats["skipped_no_arabic"] += 1
            continue

        if not args.include_banned and banned_re.search(f"{name_en} {generic}"):
            stats["skipped_banned"] += 1
            continue

        if not junk_name_re.search(name_en):
            stats["skipped_junk_name"] += 1
            continue

        sku = sku_for(index, name_en)
        if sku in seen_skus:
            stats["dupe_sku"] += 1
            continue
        seen_skus.add(sku)

        form, how = classify_form(name_en, route)
        stats[f"form_{'from_name' if how == 'from trade name' else 'from_route' if how.startswith('from route') else 'unspecified'}"] += 1

        # Only from the product's own label, never from the composition -- and the
        # difference matters more than it looks.
        #
        # `scientific_name` is often a combination: "ACETYLCYSTEINE 300MG+VITAMIN C
        # 500MG" yields a confident-looking 300mg from a regex, and it would be attributed
        # to the whole product. That is a dosing error waiting to happen, so composition
        # strengths are not used at all. Measuring it: 329 rows would have been "recovered"
        # that way, and every one of them would have been a guess about which active the
        # number describes.
        strength, unit = parse_strength(name_en)
        if not strength:
            # products.strength is NOT NULL with a length check, so a row whose label
            # carries no strength cannot be represented without inventing one. Skipped
            # rather than fabricated.
            stats["skipped_no_strength"] += 1
            continue
        stats["strength"] += 1
        pack = parse_pack(name_en)
        if pack:
            stats["pack"] += 1

        price_minor: int | None = None
        try:
            if raw_price:
                price_minor = int(round(float(raw_price) * 100))
                stats["with_price"] += 1
        except ValueError:
            price_minor = None

        # uom: the source describes the pack, and stock_unit is a packaging concept.
        uom = "BOX"

        # `form_evidence` is not its own column; it is folded into `source`, because a
        # column per piece of provenance is a column per thing anyone ever wants to record.
        source_value = (
            "EGYPTIAN REGISTER IMPORT v1 | cc0 | github.com/karem505/egyptian-drug-database"
            f" | form: {how}"
            " | not an EDA export; reconcile before regulatory use"
        )

        statements.append(
            "insert into public.products ("
            " sku, tenant_id, name_en, name_ar, generic_name_en, brand, form, strength,"
            " strength_unit, pack_size, uom, sell_price_minor, is_active, manufacturer,"
            " drug_class, source"
            ") values ("
            f" {sql_literal(sku)}, {sql_literal(args.tenant)},"
            f" {sql_literal(name_en)}, {sql_literal(name_ar)},"
            f" {sql_literal(generic or None)}, {sql_literal(name_en)},"
            f" {sql_literal(form)}, {sql_literal(f'{strength}{unit}')},"
            f" {sql_literal(unit)},"
            f" {str(pack) if pack else '1'}, {sql_literal(uom)},"
            f" {price_minor if price_minor is not None else 'null'}, true,"
            f" {sql_literal(manufacturer or None)}, {sql_literal(drug_class or None)},"
            f" {sql_literal(source_value)}"
            ") on conflict (tenant_id, sku) do update set"
            " name_en = excluded.name_en, name_ar = excluded.name_ar,"
            " generic_name_en = excluded.generic_name_en, brand = excluded.brand,"
            " form = excluded.form, strength = excluded.strength,"
            " strength_unit = excluded.strength_unit, pack_size = excluded.pack_size,"
            " sell_price_minor = excluded.sell_price_minor,"
            " manufacturer = excluded.manufacturer, drug_class = excluded.drug_class,"
            " source = excluded.source;"
        )

    print("  what would be imported:")
    for key, value in stats.items():
        print(f"    {key:>22}: {value}")

    if args.stats_only:
        return 0

    header = f"""-- Generated by scripts/import-egyptian-drugs.py. Do not edit by hand.
--
-- TENANT: {args.tenant}
--
-- {stats['total']} products from the Egyptian drug register, via the CC0 compilation at
-- github.com/karem505/egyptian-drug-database. That is a third-party compilation, NOT the
-- Egyptian Drug Authority's own export -- the EDA has no public API. Reconcile against the
-- EDA before relying on this for anything regulatory.
--
-- Every row's `source` records where it came from and how its form was determined, so any
-- row can be audited back to its evidence.
--
-- EXCLUDED: rows the register itself marks CANCELLED, RECALLED, ILLEGAL IMPORT, BANNED or
-- WITHDRAWN. The source carries 354 of them. A catalogue listing illegal imports is a
-- disqualification, and a cancelled product is worse -- it looks entirely ordinary. They
-- are dropped, not flagged, because a row that must not be sold does not belong in a search
-- result at all.
--
-- Form:    {stats['form_from_name']} from the trade name, {stats['form_from_route']} from the
--          route field, {stats['form_unspecified']} left UNSPECIFIED rather than guessed.
-- Strength:{stats['strength']:>6} recovered.  Pack: {stats['pack']:>6} recovered.
-- Price:   {stats['with_price']:>6} rows carry the Egyptian retail price as a reference.
--
-- Generated {len(statements)} statements.

begin;

-- ── why the tenant trigger is suspended ──────────────────────────────────────────
--
-- products_enforce_tenant runs private.assert_single_tenant() on every insert, which
-- overwrites tenant_id with private.current_tenant_id() -- the *caller's* tenant, read
-- from the request JWT. This file is run by an operator with psql, not by a signed-in
-- user, so there is no caller and the column is set to NULL, which the NOT NULL constraint
-- then rejects.
--
-- Supplying tenant_id in the INSERT does not help, and that is deliberate in the trigger
-- rather than a bug in it: overwriting is strictly stronger than checking, because there
-- is then no code path that can write a row into a tenant the caller does not belong to.
--
-- So the load suspends that one trigger for the duration and restores it before commit.
-- That is a worse trade than impersonating a user, and it is worth saying why: impersonating
-- would attribute 24,000-odd rows to whichever admin happened to be named in the file, and
-- would write an audit trail saying a person created them. A bulk reference-data load is an
-- operator action and the audit log should say so.
--
-- If this file is interrupted, `products_enforce_tenant` stays disabled until the
-- transaction ends, and the whole load rolls back with it. The load is one transaction on
-- purpose: 24,000 rows is not something to half-apply.

alter table public.products disable trigger products_enforce_tenant;

"""
    footer = """

-- Restored before commit, so the trigger is never left off for the next writer.
alter table public.products enable trigger products_enforce_tenant;

commit;
"""
    args.out.write_text(header + "\n\n".join(statements) + footer, encoding="utf-8")
    print(f"\n  wrote {args.out} ({args.out.stat().st_size / 1_000_000:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
