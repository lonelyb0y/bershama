#!/usr/bin/env python3
"""
check-api-types.py — keep the generated TypeScript in step with the api schema.

Every privileged stock and batch operation lives in the `api` schema, and the
typed client is how the application calls them. So the generated
apps/web/src/lib/database.types.ts is the only thing standing between a renamed
argument and a runtime error on a stock movement.

`make types` regenerates it, but nothing forces that to happen. A migration can
add a function, or rename a parameter, and the file keeps the old shape -- so
`.rpc('receive_stock', { p_qty: 10 })` type-checks, passes CI, and then fails
against the database in production with a PostgREST error about a missing
argument.

This reads both sides and fails when they disagree:

  * every `api.*` function the migrations create appears in the generated types
  * every parameter the migrations declare appears in that function's Args

Checked as text, deliberately. It runs in the `Web` CI job, which has no
database: the `Database` job applies migrations to plain PostgreSQL, which has no
`auth` or `graphql_public` schema, so `supabase gen types` there would produce a
different file and comparing whole files would fail for reasons that have nothing
to do with drift. Comparing the parts that matter keeps the check honest about
what it can and cannot see.

Usage: scripts/check-api-types.py
Exit: 0 in step, 1 out of step.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = REPO_ROOT / "supabase" / "migrations"
TYPES = REPO_ROOT / "apps" / "web" / "src" / "lib" / "database.types.ts"

GREEN = "\033[1;32m"
RED = "\033[1;31m"
BOLD = "\033[1m"
RESET = "\033[0m"

# `create or replace function api.stock_take(`. Deliberately not anchored to a
# line ending, because signatures vary: current_tenant_id() closes its parens on
# the same line as its name, while search_products spans a dozen lines. A regex
# written against the shape that happened to be in front of me reported four
# functions as "no migration creates it" and two typed functions as missing.
SIG_RE = re.compile(r"create\s+or\s+replace\s+function\s+api\.([a-z_]+)\s*\(", re.I)

# A parameter is `p_name type`, so this matches the name at the start of a segment.
PARAM_RE = re.compile(r"^\s*(p_[a-z0-9_]+)\s+", re.I)

def balanced(src: str, open_at: int) -> str:
    """The text between the delimiter at open_at and its matching close.

    Handles parentheses (SQL signatures) and braces (the generated types' `Args: {`
    block), and skips quoted text: a default like `default ', '` and a comment
    containing a parenthesis both occur in real signatures here, and a naive depth
    count then returns the wrong span -- a silent wrong answer rather than an error.
    """
    depth = 0
    quote: str | None = None
    i = open_at
    while i < len(src):
        ch = src[i]
        if quote:
            if ch == quote:
                quote = None
        elif ch in "'\"":
            quote = ch
        elif ch in "({":
            depth += 1
        elif ch in ")}":
            depth -= 1
            if depth == 0:
                return src[open_at + 1 : i]
        i += 1
    raise ValueError("unbalanced parentheses in signature")


def split_args(body: str) -> list[str]:
    """Split an argument list on commas that are not nested or quoted."""
    segments: list[str] = []
    buf: list[str] = []
    depth = 0
    for ch in body:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        if ch == "," and depth == 0:
            segments.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    segments.append("".join(buf))
    return segments


def collect_from_migrations() -> dict[str, list[set[str]]]:
    """{function name: [argument names of its current signature]}

    ── why the newest `create or replace` wins ──────────────────────────────────
    This schema evolves a function with `create or replace` and drops the old
    signature in a later migration, so the newest definition is the one the database
    serves. Collecting every signature ever written and comparing the first against
    the generated types reported two invented arguments on api.update_product, whose
    database definition was correct -- the check was describing a function that had
    not existed for several migrations.

    A name that is deliberately overloaded would break this rule, and this project
    has been bitten three times by *accidental* overloads rather than deliberate
    ones, so 0047 now asserts at the database that no api.* name has two signatures.
    That assertion is what makes "newest wins" safe rather than merely convenient.
    """
    found: dict[str, set[str]] = {}

    for path in sorted(MIGRATIONS.glob("*.sql")):
        src = path.read_text()
        for match in SIG_RE.finditer(src):
            name = match.group(1).lower()
            body = balanced(src, match.end() - 1)

            params: set[str] = set()
            for decl in split_args(body):
                pm = PARAM_RE.match(decl)
                if pm:
                    params.add(pm.group(1))

            # Reassigned rather than merged: later migrations supersede earlier ones.
            found[name] = params

    return {name: [params] for name, params in found.items()}


def collect_from_types() -> dict[str, set[str]]:
    """{function name: arg names} as generated.

    Anchored on indentation rather than on a shape. The generated file nests
    `api:` at 2 spaces, `Functions:` at 4 and each function at 6, so a function
    entry is a line starting with exactly six spaces followed by `name: {`.
    Matching the shape instead reported Tables, Views and Enums as functions,
    under the names "ables" and "iews", because the pattern happily matched the
    tail of a capitalised word.
    """
    src = TYPES.read_text()

    api_start = src.find("api: {")
    public_start = src.find("public: {")
    if api_start == -1 or public_start == -1 or public_start < api_start:
        return {}
    api_block = src[api_start:public_start]

    fn_start = api_block.find("Functions: {")
    if fn_start == -1:
        return {}
    fn_block = api_block[fn_start + len("Functions: {"):]

    found: dict[str, set[str]] = {}
    for match in re.finditer(r"(?m)^      ([A-Za-z_][A-Za-z0-9_]*): \{", fn_block):
        brace = match.end() - 1
        rest = fn_block[brace + 1 : brace + 400]
        args_at = rest.find("Args:")
        if args_at == -1:
            continue

        # A no-argument function is rendered `Args: Record<PropertyKey, never>`
        # with no brace at all, which is correct: it has no parameters.
        scan = brace + 1 + args_at + 5
        while scan < len(fn_block) and fn_block[scan] in " \t\n":
            scan += 1
        if scan >= len(fn_block) or fn_block[scan] != "{":
            found[match.group(1)] = set()
            continue

        args = balanced(fn_block, scan)
        found[match.group(1)] = set(
            re.findall(r"\b(p_[a-z0-9_]+)\s*\??\s*:", args)
        )

    return found


def main() -> int:
    print(f"{BOLD}Checking the generated types against the api schema{RESET}\n")

    db = collect_from_migrations()
    ts = collect_from_types()

    print(f"  migrations declare : {len(db)} api functions")
    print(f"  types describe     : {len(ts)} api functions")
    print()

    problems: list[str] = []

    missing = sorted(set(db) - set(ts))
    for name in missing:
        problems.append(
            f"api.{name} exists in the migrations but is absent from "
            f"database.types.ts. Run `make types`."
        )

    extra = sorted(set(ts) - set(db))
    for name in extra:
        problems.append(
            f"database.types.ts describes {name!r} as an api function but no "
            f"migration creates it. Probably a stale generated file."
        )

    for name in sorted(set(db) & set(ts)):
        # Exactly one signature survived for this function, because a later drop
        # removed the others. With more than one, this compares against the first and
        # the note underneath says so -- the generated types keep only one.
        declared = db[name][0]
        typed = ts[name]
        args_missing = sorted(declared - typed)
        args_extra = sorted(typed - declared)
        for arg in args_missing:
            problems.append(
                f"api.{name} declares {arg} but the generated types do not have "
                f"it. A call passing {arg} will not type-check, and one not "
                f"passing it fails at runtime. Run `make types`."
            )
        for arg in args_extra:
            problems.append(
                f"database.types.ts has {name}.{arg}, which the migrations do "
                f"not declare."
            )

    # Overloads collapse to one entry in the generated types, so a function with
    # two distinct signatures is a case this check cannot fully verify. Say so
    # rather than let it read as verified.
    overloaded = {n: sigs for n, sigs in db.items() if len(sigs) > 1}
    if overloaded:
        print("  note: these api functions are overloaded, and the generated types")
        print("        keep only one signature, so the check is partial for them:")
        for name in sorted(overloaded):
            print(f"          api.{name}  ({len(overloaded[name])} signatures)")
        print()

    if problems:
        for problem in problems:
            print(f"{RED}  FAIL{RESET} {problem}")
        print()
        print(f"{RED}{len(problems)} problem(s).{RESET}")
        return 1

    print(f"{GREEN}  In step: {len(db)} api functions typed with the right arguments.{RESET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
