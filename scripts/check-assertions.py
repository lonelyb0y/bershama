#!/usr/bin/env python3
"""
check-assertions.py — static check that the pgTAP suites are portable.

The local harness prefers real pgTAP and falls back to a shim
(supabase/tests/pgtap_shim.sql) when the extension is unavailable. The shim is a
SUBSET of pgTAP, and two of its differences are silent:

  1. Functions. The shim once offered is_null/is_not_null, which pgTAP does not
     have. A suite using them passed locally and failed in CI.

  2. Type strictness. pgTAP's results_eq compares values BY TYPE and raises
     "cannot compare dissimilar column types" on a mismatch. The shim casts
     everything to text and shrugs. Same SQL, different result depending on which
     engine ran it -- which is how a suite that is green locally fails in CI on
     nothing but the presence of the extension.

Both are caught here, statically, in under a second, on every machine. Discovering
them by waiting for CI is how this class of bug reaches main.

The governing rule: THE SHIM MUST NEVER BE MORE PERMISSIVE THAN pgTAP. It may be
less capable, because that fails loudly. It may not be more capable, because that
hides.

Usage: scripts/check-assertions.py
Exit: 0 clean, 1 problems found.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SUITE_DIR = REPO_ROOT / "supabase" / "tests"
SHIM = SUITE_DIR / "pgtap_shim.sql"

GREEN = "\033[1;32m"
RED = "\033[1;31m"
BOLD = "\033[1m"
RESET = "\033[0m"

# The intersection: assertion functions real pgTAP provides. A suite using anything
# outside this set is either a typo or relying on a shim-only invention.
PGTAP_FUNCTIONS = {
    "plan", "finish", "ok", "is", "isnt", "is_empty", "results_eq",
    "throws_ok", "lives_ok", "isnt_empty", "set_eq", "bag_eq",
    "pass", "fail", "diag", "no_plan", "skip", "todo_skip",
}

problems: list[str] = []


def find_suites() -> list[Path]:
    return sorted(SUITE_DIR.glob("*.test.sql"))


# ── 1. assertion functions must exist in pgTAP ───────────────────────────────
def check_functions(suites: list[Path]) -> None:
    for suite in suites:
        src = suite.read_text()
        # Functions the suite defines itself, in pg_temp or any schema.
        local_defs = set(
            re.findall(r"create\s+or\s+replace\s+function\s+[\w.]*?(\w+)\s*\(", src, re.I)
        )
        local_defs |= set(re.findall(r"create\s+function\s+[\w.]*?(\w+)\s*\(", src, re.I))

        # `[ \t]+` rather than `\s+` between the keyword and the function name.
        # `\s` matches newlines, so a bare
        #     select
        #       count(*)
        # -- a CTE, or any multi-line subquery -- was read as `select count(` and
        # reported as an unknown assertion function. Found because the checker
        # rejected two perfectly good assertions rather than because anyone was
        # looking for that class of false positive.
        for match in re.finditer(
            r"^[ \t]*select[ \t]+([a-z_][a-z0-9_]*)[ \t]*\(", src, re.M | re.I
        ):
            fn = match.group(1).lower()
            line = src[: match.start()].count("\n") + 1
            # A SELECT of a table or expression, not an assertion.
            if fn in {"select", "exists"}:
                continue
            if fn in PGTAP_FUNCTIONS:
                continue
            if fn in {d.lower() for d in local_defs}:
                continue
            problems.append(
                f"{suite.name}:{line}  '{fn}(' is not a pgTAP assertion function"
            )


# ── 2. results_eq must be type-stable across engines ─────────────────────────
def check_results_eq(suites: list[Path]) -> None:
    """
    results_eq(sql, want, description).

    pgTAP compares the first column of `sql` against `want` by type. The shim casts
    both to text. A pair that relies on pgTAP's type inference can pass on one
    engine and fail on the other.

    The enforceable convention: AT LEAST ONE side of every comparison carries an
    explicit cast. That makes the intended type unambiguous and identical on both
    engines, and it is checkable without a type catalogue. A pair with no cast
    anywhere is the ambiguous case and is reported.
    """
    for suite in suites:
        src = suite.read_text()
        for match in re.finditer(r"results_eq\s*\(", src):
            # Take the call body up to the matching close paren, respecting quotes.
            start = match.end()
            depth = 1
            i = start
            while i < len(src) and depth:
                if src[i] in "([":
                    depth += 1
                elif src[i] in ")]":
                    depth -= 1
                i += 1
            body = src[start : i - 1]
            line = src[: match.start()].count("\n") + 1

            # Split off the query: the first $$...$$ / $tag$...$tag$ / '...' chunk.
            q = re.match(r"\s*(\$\$[^\$]*\$\$|\$[a-zA-Z_]*\$[^\$]*\$[a-zA-Z_]*\$|E?'(?:[^']|'')*')", body)
            if not q:
                problems.append(f"{suite.name}:{line}  results_eq: could not parse the query")
                continue
            query = q.group(1)
            rest = body[q.end() :]

            # The expected array literal follows the query.
            a = re.search(r"(array\s*\[.*?\]|ARRAY\s*\[.*?\])", rest, re.S | re.I)
            if not a:
                problems.append(f"{suite.name}:{line}  results_eq: could not parse the expected array")
                continue
            want = a.group(1)

            query_cast = "::" in query
            want_cast = "::" in want

            if not query_cast and not want_cast:
                expr = query.strip("$'E ").replace("$$", " ").strip()
                expr = re.sub(r"^select\s+", "", expr, flags=re.I)[:64]
                problems.append(
                    f"{suite.name}:{line}  results_eq has no explicit cast on either side, "
                    f"so the type is inferred differently by pgTAP and the shim: {expr}"
                )


# ── 3. the shim must be a strict subset of pgTAP ────────────────────────────
def check_shim_is_subset() -> None:
    if not SHIM.exists():
        problems.append(f"{SHIM.relative_to(REPO_ROOT)}  is missing")
        return
    src = SHIM.read_text()
    defined = set(re.findall(r"create\s+or\s+replace\s+function\s+pgtap_shim\.(\w+)", src))
    for fn in sorted(defined):
        # Underscore-prefixed helpers are internal plumbing (_bump, _reset) that no
        # suite calls portably; they are not part of the assertion surface.
        if fn.startswith("_"):
            continue
        if fn.lower() not in PGTAP_FUNCTIONS:
            problems.append(
                f"pgtap_shim.{fn}  the shim provides a function pgTAP does not, "
                f"so a suite can use it locally and fail in CI"
            )
    return


def main() -> int:
    suites = find_suites()
    if not suites:
        print(f"{RED}No test suites found in {SUITE_DIR}{RESET}")
        return 1

    print(f"{BOLD}Checking {len(suites)} suite(s) for pgTAP portability{RESET}\n")

    check_functions(suites)
    check_results_eq(suites)
    check_shim_is_subset()

    # Report the pgTAP functions each suite uses, so the inventory is visible.
    print("  assertion functions in use:")
    for suite in suites:
        src = suite.read_text()
        used = set()
        for match in re.finditer(r"^\s*select\s+([a-z_][a-z0-9_]*)\s*\(", src, re.M | re.I):
            fn = match.group(1).lower()
            if fn in PGTAP_FUNCTIONS:
                used.add(fn)
        print(f"    {suite.name:28} {' '.join(sorted(used))}")
    print()

    if problems:
        for problem in problems:
            print(f"{RED}  FAIL{RESET} {problem}")
        print()
        print(
            f"{RED}{len(problems)} problem(s).{RESET} A suite that passes against the shim "
            f"can still fail against real pgTAP."
        )
        return 1

    print(f"{GREEN}  All assertions are portable: real pgTAP functions only, "
          f"type-stable comparisons, shim a strict subset.{RESET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
