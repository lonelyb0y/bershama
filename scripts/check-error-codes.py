#!/usr/bin/env python3
"""
check-error-codes.py — keep the client error mapper in step with the database.

The database raises a stable error CODE (see the convention at the top of
supabase/migrations/20260101000009_movements.sql). apps/web/src/lib/errors.ts maps
each of them to a localised message.

Nothing at build time connects those two lists. A migration can add a code, CI
stays green, and the user sees a generic fallback — which is a bug that is invisible
in English, invisible in CI, and only noticed by an Arabic speaker who needed the
specific number.

So this reads both sides and fails if they disagree.

Usage: scripts/check-error-codes.py
Exit: 0 in step, 1 out of step.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = REPO_ROOT / "supabase" / "migrations"
MAPPER = REPO_ROOT / "apps" / "web" / "src" / "lib" / "errors.ts"

GREEN = "\033[1;32m"
RED = "\033[1;31m"
BOLD = "\033[1m"
RESET = "\033[0m"

# Postgres error classes, so a raise on a different class is not mistaken for a
# deliberately-raised code. Only P0001 (raise_exception) and 42501
# (insufficient_privilege) carry codes we map; 23505 and 23514 are constraint
# violations, which are bugs rather than user errors and get a different path.
MAPPED_ERRCODES = {"P0001", "42501"}


def collect_from_migrations() -> set[str]:
    """Every error code the migrations raise deliberately."""
    codes: set[str] = set()

    for path in sorted(MIGRATIONS.glob("*.sql")):
        src = path.read_text()

        # raise exception using errcode = 'P0001', message = 'some_code', ...
        for match in re.finditer(
            r"raise\s+exception(?:\s+using)?[^;]*?message\s*=\s*'([a-z0-9_]+)'",
            src,
            re.S | re.I,
        ):
            codes.add(match.group(1))

        # The two-argument form: raise exception 'some_code', 'detail' using ...
        for match in re.finditer(
            r"raise\s+exception\s+'([a-z0-9_]+)'\s*,\s*'",
            src,
            re.S | re.I,
        ):
            codes.add(match.group(1))

        # raise exception 'some_code';
        for match in re.finditer(
            r"raise\s+exception\s+'([a-z0-9_]+)'\s*;",
            src,
            re.S | re.I,
        ):
            codes.add(match.group(1))

    return codes


def collect_from_mapper() -> set[str]:
    """Every code the client knows how to render."""
    src = MAPPER.read_text()

    m = re.search(r"export const knownCodes[^=]*=\s*\[(.*?)\];", src, re.S)
    if not m:
        print(f"{RED}  could not find the knownCodes array in errors.ts{RESET}")
        return set()

    return set(re.findall(r"'([a-z0-9_]+)'", m.group(1)))


def collect_message_keys() -> set[str]:
    """Keys actually defined in the MESSAGES catalog."""
    src = MAPPER.read_text()
    m = re.search(r"const MESSAGES = \{(.*?)\n\} as const;", src, re.S)
    if not m:
        return set()
    return set(re.findall(r"^  ([a-z0-9_]+):\s*\{", m.group(1), re.M))


def collect_raised_errcodes() -> set[str]:
    """The errcode values used with those raises, to spot an unmapped class."""
    codes: set[str] = set()
    for path in sorted(MIGRATIONS.glob("*.sql")):
        src = path.read_text()
        for match in re.finditer(r"errcode\s*=\s*'(\w+)'", src, re.I):
            codes.add(match.group(1).upper())
    return codes


def main() -> int:
    print(f"{BOLD}Checking the client error mapper against the migrations{RESET}\n")

    db_codes = collect_from_migrations()
    ui_codes = collect_from_mapper()
    msg_keys = collect_message_keys()
    errcodes_used = collect_raised_errcodes()

    print(f"  migrations raise      : {len(db_codes)} codes")
    print(f"  errors.ts knows       : {len(ui_codes)} codes")
    print(f"  MESSAGES defines      : {len(msg_keys)} entries")
    print(f"  errcodes used         : {', '.join(sorted(errcodes_used))}")
    print()

    problems: list[str] = []

    # The user-visible failure: a code the database raises with no message.
    unmapped = sorted(db_codes - ui_codes)
    for code in unmapped:
        problems.append(
            f"the database raises '{code}' but errors.ts has no message for it. "
            f"A user hitting this sees a generic fallback."
        )

    # The reverse: a message for a code the database no longer raises. Harmless
    # today, wrong tomorrow, and a sign the mapper is being maintained by hand.
    stale = sorted(ui_codes - db_codes)
    for code in stale:
        problems.append(
            f"errors.ts maps '{code}' but no migration raises it. "
            f"Dead mapping; remove it or the migrations and the client have diverged."
        )

    # knownCodes and MESSAGES must agree with each other, or the test that
    # compares them to the migrations is comparing against a fiction.
    only_in_list = sorted(ui_codes - msg_keys)
    only_in_messages = sorted(msg_keys - ui_codes)
    for code in only_in_list:
        problems.append(
            f"errors.ts lists '{code}' in knownCodes but defines no MESSAGES entry for it."
        )
    for code in only_in_messages:
        problems.append(
            f"errors.ts defines a MESSAGES entry for '{code}' but omits it from knownCodes, "
            f"so the drift test will not notice it going stale."
        )

    # An errcode outside the mapped set would be a class the mapper does not
    # handle at all, which is worth knowing about even though it is not a drift.
    unexpected = sorted(errcodes_used - MAPPED_ERRCODES)
    if unexpected:
        print(
            f"  note: migrations also use errcode(s) {', '.join(unexpected)} "
            f"outside the mapped set. Those are constraint violations rather than\n"
            f"        deliberate raises, so they need a different client path.\n"
        )

    if problems:
        for problem in problems:
            print(f"{RED}  FAIL{RESET} {problem}")
        print()
        print(f"{RED}{len(problems)} drift problem(s).{RESET}")
        return 1

    print(f"{GREEN}  In step: every code the database raises is mapped, localised, "
          f"and listed.{RESET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
