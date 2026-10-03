#!/usr/bin/env python3
"""Fail when the hosted security advisor reports something the baseline does not allow.

Reads the advisor payload written to /tmp/advisors.json and compares it against
supabase/advisor-baseline.json.

## Why a baseline rather than "zero findings"

The advisor reports all 38 `api.*` wrappers on every run, and will keep reporting them.
They are the application's write API: each is SECURITY DEFINER because `private` grants no
USAGE to client roles, and each authorises the caller's role and tenant internally.
Requiring an empty report would mean deleting the write API.

So the baseline records, per lint *name*, how many findings are tolerated and why. That
catches the two things worth catching:

  - a lint name that is not in the baseline at all -- someone added a SECURITY DEFINER
    function to an exposed schema and nobody reviewed it, or the platform shipped a new
    default;
  - a count that has grown past the accepted number -- one more api.* wrapper than the
    allow-list in supabase/tests/rls_coverage.test.sql actually permits.

Both are fail-closed. Accepting a new finding is a deliberate edit to a reviewed file.

## Exit codes

  0  within the baseline
  1  something new, or over an accepted count
  2  the input or the baseline is unusable -- treated as failure, not as success
"""

from __future__ import annotations

import json
import os
import sys
from collections import Counter
from pathlib import Path

REPORT = Path(os.environ.get("ADVISORS_REPORT", "/tmp/advisors.json"))
BASELINE = Path(__file__).resolve().parent.parent / "supabase" / "advisor-baseline.json"


def fail(message: str) -> "None":
    print(f"::error::{message}")
    sys.exit(2)


def main() -> None:
    if not REPORT.exists():
        fail(f"no advisor report at {REPORT}")
    if not BASELINE.exists():
        fail(f"no baseline at {BASELINE}")

    try:
        report = json.loads(REPORT.read_text())
    except json.JSONDecodeError as exc:
        fail(f"advisor report is not valid JSON: {exc}")
    if not BASELINE.is_file() or not is_readable_json(BASELINE):
        fail(f"baseline at {BASELINE} is not valid JSON")

    accepted = json.loads(BASELINE.read_text()).get("accepted", {})

    lints = report.get("lints", []) if isinstance(report, dict) else report
    if not isinstance(lints, list):
        fail("advisor payload has no 'lints' array")

    counts = Counter()
    detail: dict[str, list[str]] = {}
    for lint in lints:
        name = lint.get("name", "unnamed-lint")
        for finding in lint.get("findings", []):
            counts[name] += 1
            detail.setdefault(name, []).append(finding.get("detail", ""))

    print(f"  advisor reported {sum(counts.values())} finding(s) across {len(counts)} lint(s)")

    unknown = {name: n for name, n in counts.items() if name not in accepted}
    over = {
        name: (n, accepted[name].get("max_count"))
        for name, n in counts.items()
        if name in accepted and n > accepted[name].get("max_count", 0)
    }

    for name in sorted(set(counts) - set(unknown) - set(over)):
        print(f"  ok       {name}: {counts[name]} (accepted)")

    problems = False
    for name, n in sorted(unknown.items()):
        problems = True
        print(f"\n  NEW      {name}: {n} finding(s), not in the baseline")
        for d in detail[name][:3]:
            print(f"            {d[:180]}")
    for name, (n, cap) in sorted(over.items()):
        problems = True
        print(f"\n  OVER     {name}: {n} finding(s), baseline accepts {cap}")
        print("            Either a function was added, or the baseline is stale.")

    if problems:
        print(
            "\n  Fix the finding, or accept it deliberately by editing "
            "supabase/advisor-baseline.json with a reason."
        )
        sys.exit(1)

    print("  nothing new.")


def is_readable_json(path: Path) -> bool:
    try:
        json.loads(path.read_text())
        return True
    except json.JSONDecodeError:
        return False


if __name__ == "__main__":
    main()
