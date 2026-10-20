#!/usr/bin/env bash
# ============================================================================
# verify-db.sh — run the real migrations and the real test suites against a
# plain PostgreSQL instance, without Docker.
#
# WHY THIS EXISTS
#
# The normal path is `supabase start` + `supabase test db`, which runs the whole
# stack in Docker. Docker is not always available. A migration set that can only
# be verified with Docker is a migration set that silently rots.
#
# This script applies supabase/migrations/* in order to a throwaway database,
# then runs supabase/tests/*.test.sql. It is the same SQL in both paths; only the
# harness differs. See supabase/README-dev.md.
#
# Usage:
#   scripts/verify-db.sh [port]
#
# Requires: initdb, pg_ctl, psql on PATH (PostgreSQL 14+).
# ============================================================================
set -euo pipefail

PORT="${1:-55432}"
SOCKET_DIR="$(mktemp -d /tmp/pf-verify-sock.XXXXXX)"
PGDATA_DIR="$(mktemp -d /tmp/pf-verify-data.XXXXXX)"
DB_NAME="bershama_verify"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export PGHOST="$SOCKET_DIR" PGPORT="$PORT" PGUSER=postgres

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m  FAIL\033[0m %s\n' "$*" >&2; exit 1; }

cleanup() {
  pg_ctl -D "$PGDATA_DIR" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$PGDATA_DIR" "$SOCKET_DIR"
}
trap cleanup EXIT

# ── locate the PostgreSQL binaries ───────────────────────────────────────────
#
# initdb and pg_ctl are SERVER binaries. They live in
# /usr/lib/postgresql/<major>/bin on Debian/Ubuntu, which is not on PATH on a
# bare machine, and a `postgresql-client-N` install does not include them at all.
# That mistake was made once in this project's CI and cost a run.
#
# So: check PATH first, then fall back to the versioned install directories.
# Handling it here as well as in CI means a developer on an unusual system gets
# a working setup rather than a "not found" error with no explanation.

require_pg_bin() {
  local bin="$1"

  if command -v "$bin" >/dev/null 2>&1; then
    return 0
  fi

  # Highest version first, so a machine with several installed uses the newest.
  local candidate
  for candidate in $(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -Vr); do
    if [ -x "$candidate/$bin" ]; then
      PATH="$candidate:$PATH"
      export PATH
      return 0
    fi
  done

  # pg_wrapper style locations, e.g. /usr/pgsql-17/bin on RHEL-family systems.
  for candidate in $(ls -d /usr/pgsql-*/bin 2>/dev/null | sort -Vr); do
    if [ -x "$candidate/$bin" ]; then
      PATH="$candidate:$PATH"
      export PATH
      return 0
    fi
  done

  die "$bin not found. Install the PostgreSQL SERVER package (not just the
       client): it provides initdb and pg_ctl under /usr/lib/postgresql/<major>/bin."
}

for required_bin in initdb pg_ctl psql; do
  require_pg_bin "$required_bin"
done

# ── 1. throwaway cluster ─────────────────────────────────────────────────────
log "Initialising a throwaway PostgreSQL cluster on port $PORT"
log "  using $(initdb --version)"
initdb -D "$PGDATA_DIR" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null 2>&1
pg_ctl -D "$PGDATA_DIR" -o "-p $PORT -k $SOCKET_DIR" -l "$PGDATA_DIR/pg.log" -w start >/dev/null
ok "cluster up"

# ── 2. fresh database ────────────────────────────────────────────────────────
psql -q -d postgres -c "drop database if exists $DB_NAME;" >/dev/null 2>&1 || true
psql -q -d postgres -c "create database $DB_NAME;" >/dev/null
export PGDATABASE="$DB_NAME"

# ── 3. Supabase compatibility layer, then the assertion shim ─────────────────
# Order matters: the shim revokes privileges from anon/authenticated, so those
# roles must already exist. That is why the compat layer is applied first.
#
# Roles, auth schema, auth.uid(). Not applied on a real Supabase project.
psql -q -v ON_ERROR_STOP=1 -f "$REPO_ROOT/supabase/tests/0000_supabase_compat.sql" >/dev/null
ok "supabase compatibility layer (roles, auth schema, auth.uid)"

# Prefer the real pgTAP extension. If it is unavailable (it needs a system
# package and therefore root) install the compatible shim so the suites still
# run, and say so loudly rather than pretending the real thing was used.
USE_SHIM=0
if psql -q -c "create extension if not exists pgtap;" >/dev/null 2>&1; then
  ok "pgtap extension available"
else
  psql -q -v ON_ERROR_STOP=1 -f "$REPO_ROOT/supabase/tests/pgtap_shim.sql" >/dev/null
  USE_SHIM=1
  printf '\033[1;33m  warn\033[0m %s\n' \
    "pgtap extension not installed; using the compatibility shim."
fi

# ── 5. migrations, in order ──────────────────────────────────────────────────
log "Applying migrations"
for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
  name="$(basename "$f")"
  if psql -q -v ON_ERROR_STOP=1 -f "$f" >"$PGDATA_DIR/mig.err" 2>&1; then
    ok "$name"
  else
    printf '\033[1;31m  FAIL\033[0m %s\n' "$name" >&2
    cat "$PGDATA_DIR/mig.err" >&2
    exit 1
  fi
done

# ── 6. seed ──────────────────────────────────────────────────────────────────
log "Applying seed"
if psql -q -v ON_ERROR_STOP=1 -f "$REPO_ROOT/supabase/seed.sql" >"$PGDATA_DIR/seed.err" 2>&1; then
  ok "seed.sql"
else
  printf '\033[1;31m  FAIL\033[0m seed.sql\n' >&2
  cat "$PGDATA_DIR/seed.err" >&2
  exit 1
fi

# ── 7. test suites ───────────────────────────────────────────────────────────
log "Running test suites"
FAILED=0
TOTAL=0

# Summarise a suite from its output, whatever engine produced it.
#
# The shim prints "ran N of M assertions, K failed". Real pgTAP prints TAP:
#
#   1..23
#   ok 1 - anon cannot read tenants
#   not ok 5 - a user cannot escalate their own role
#
# so a grep for the shim's wording matches nothing against the real extension.
#
# That was not a cosmetic difference. Under `set -e`, a command substitution that
# yields a non-zero status aborts the script, so a grep that found no match
# killed the run at that point -- before the failure branch could print anything.
# The suites could have been failing and the log would have shown a bare
# "exit code 1" with no reason at all, which is exactly what happened in CI.
#
# Hence: `|| true` on every substitution, and a summary that understands both
# formats. A missing summary now falls back to the raw tail so the output is
# still informative.
summarise() {
  local outfile="$1" engine="$2"
  local planned passed failed

  if [ "$engine" = "shim" ]; then
    # The shim aborts on the first failed assertion, so there is at most one.
    local n
    n="$(grep -oE 'ran [0-9]+ of [0-9]+ assertions, [0-9]+ failed' "$outfile" | tail -1)" || true
    if [ -n "$n" ]; then
      printf '%s' "$n"
      return 0
    fi
    # An aborting shim run has no summary, but it does name the assertion and
    # the reason, which is the part worth showing.
    local detail
    detail="$(grep -oE 'FAILED #[0-9]+: .*' "$outfile" | head -1)" || true
    if [ -n "$detail" ]; then
      printf 'aborted at %s' "$detail"
      return 0
    fi
  fi

  # TAP: the plan line gives the expected count, ok/not ok give the results.
  # Leading whitespace is expected -- see the note in suite_passed() above, and
  # these patterns must stay in step with the ones there.
  #
  # The plan number is what follows "1..", not the first run of digits on the
  # line, so the leading "1" has to be stripped explicitly.
  planned="$(grep -oE '^[[:space:]]*1\.\.[0-9]+' "$outfile" | tail -1 | sed -E 's/^.*1\.\.//')" || true
  passed="$(grep -cE '^[[:space:]]*ok [0-9]+' "$outfile" || true)"
  failed="$(grep -cE '^[[:space:]]*not ok [0-9]+' "$outfile" || true)"

  if [ -n "$planned" ] || [ "$passed" -gt 0 ] || [ "$failed" -gt 0 ]; then
    printf '%s of %s assertions, %s failed' \
      "$((passed + failed))" "${planned:-$((passed + failed))}" "$failed"
  else
    # Nothing recognisable: show the tail rather than an empty summary, so a
    # syntax error or a missing function is still visible.
    printf 'no TAP output; last line was: %s' "$(tail -1 "$outfile")"
  fi
}

for f in "$REPO_ROOT"/supabase/tests/*.test.sql; do
  name="$(basename "$f")"
  TOTAL=$((TOTAL + 1))

  # A suite that reports nothing has NOT passed.
  #
  # This check exists because the alternative is the worst possible harness
  # failure: psql exits 0, the output is empty, and a naive "did psql succeed?"
  # test reports the suite as green. That is how a security suite ends up
  # asserting nothing while the build says it passed. An empty or TAP-less
  # result is a failure, always, and the raw output is dumped so the reason is
  # visible.
  #
  # The patterns tolerate leading whitespace because psql renders a returned TAP
  # line in an aligned column, which prefixes it with a space:
  #
  #                            ok
  #   ----------------------------------------------------------
  #    ok 5 - the private schema is not reachable by client roles
  #   (1 row)
  #
  #   plan
  #   -------
  #    1..23
  #
  # So "1..23" is " 1..23" and "ok 5" is " ok 5" in captured output. A digit is
  # required after "ok" so the bare column header "ok" is not counted as a
  # result.
  suite_passed() {
    local outfile="$1" engine="$2"
    local planned failed

    if [ "$engine" = "shim" ]; then
      # The shim aborts on the first failed assertion and prints a summary line;
      # absence of that means the file did not really run.
      grep -qE 'ran [0-9]+ of [0-9]+ assertions, 0 failed' "$outfile" && return 0
      return 1
    fi

    # Real pgTAP: a failed assertion is reported as a "not ok" line and the
    # script still EXITS 0. Exit status therefore cannot detect a failing suite,
    # which is exactly why pg_prove and `supabase test db` parse TAP rather than
    # trusting the exit code. Any "not ok" is a failure, full stop.
    failed="$(grep -cE '^[[:space:]]*not ok [0-9]+' "$outfile" || true)"
    [ "$failed" -eq 0 ] || return 1

    planned="$(grep -cE '^[[:space:]]*1\.\.[0-9]+' "$outfile" || true)"
    [ "$planned" -gt 0 ] || return 1

    grep -qE '^[[:space:]]*ok [0-9]+' "$outfile" && return 0
    return 1
  }

  # Each suite is its own transaction: pgTAP suites begin/rollback internally, and
  # a failure in one must not leave state behind for the next.
  if [ "$USE_SHIM" -eq 1 ]; then
    psql -q -v ON_ERROR_STOP=1 \
      -c "set search_path = public, pgtap_shim;" \
      -c "select pgtap_shim._reset();" >/dev/null 2>&1 || true

    if psql -q -v ON_ERROR_STOP=1 \
        -c "set search_path = public, pgtap_shim;" \
        -f "$f" >"$PGDATA_DIR/test.out" 2>&1 && suite_passed "$PGDATA_DIR/test.out" shim; then
      ok "$name — $(summarise "$PGDATA_DIR/test.out" shim)"
    else
      printf '\033[1;31m  FAIL\033[0m %s\n' "$name" >&2
      printf '         %s bytes of output; a passing suite must report its plan and results\n' \
        "$(wc -c <"$PGDATA_DIR/test.out" | tr -d ' ')" >&2
      cat "$PGDATA_DIR/test.out" >&2
      FAILED=$((FAILED + 1))
    fi
  else
    # No -q here, and client_min_messages lowered.
    #
    # pgTAP reports each assertion to the client rather than returning it as a
    # result set, so anything that suppresses messages or result formatting can
    # hide the entire run. Dropping -q and pinning the message level to info
    # means the output is the same regardless of the caller's environment, and
    # suite_passed() above catches the case where it is still not.
    if PGOPTIONS='-c client_min_messages=info' \
       psql -X -v ON_ERROR_STOP=1 -f "$f" >"$PGDATA_DIR/test.out" 2>&1 \
       && suite_passed "$PGDATA_DIR/test.out" pgtap; then
      ok "$name — $(summarise "$PGDATA_DIR/test.out" pgtap)"
    else
      printf '\033[1;31m  FAIL\033[0m %s\n' "$name" >&2
      printf '         %s bytes of output; expected a TAP plan line and results\n' \
        "$(wc -c <"$PGDATA_DIR/test.out" | tr -d ' ')" >&2
      cat "$PGDATA_DIR/test.out" >&2
      FAILED=$((FAILED + 1))
    fi
  fi
done

echo
if [ "$FAILED" -eq 0 ]; then
  printf '\033[1;32mAll %s suites passed.\033[0m\n' "$TOTAL"
  exit 0
else
  printf '\033[1;31m%s of %s suites failed.\033[0m\n' "$FAILED" "$TOTAL" >&2
  exit 1
fi
