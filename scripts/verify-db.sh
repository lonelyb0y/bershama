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
DB_NAME="pharmaflow_verify"
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

for f in "$REPO_ROOT"/supabase/tests/*.test.sql; do
  name="$(basename "$f")"
  TOTAL=$((TOTAL + 1))

  # Each suite is its own transaction: pgTAP suites begin/rollback internally, and
  # a failure in one must not leave state behind for the next.
  if [ "$USE_SHIM" -eq 1 ]; then
    psql -q -v ON_ERROR_STOP=1 \
      -c "set search_path = public, pgtap_shim;" \
      -c "select pgtap_shim._reset();" >/dev/null 2>&1 || true
    if psql -q -v ON_ERROR_STOP=1 \
        -c "set search_path = public, pgtap_shim;" \
        -f "$f" >"$PGDATA_DIR/test.out" 2>&1; then
      summary=$(grep -oE 'ran [0-9]+ of [0-9]+ assertions, [0-9]+ failed' "$PGDATA_DIR/test.out" | tail -1)
      ok "$name — $summary"
    else
      printf '\033[1;31m  FAIL\033[0m %s\n' "$name" >&2
      cat "$PGDATA_DIR/test.out" >&2
      FAILED=$((FAILED + 1))
    fi
  else
    if psql -q -v ON_ERROR_STOP=1 -f "$f" >"$PGDATA_DIR/test.out" 2>&1; then
      summary=$(grep -oE 'ran [0-9]+ of [0-9]+ assertions, [0-9]+ failed' "$PGDATA_DIR/test.out" | tail -1)
      ok "$name — $summary"
    else
      printf '\033[1;31m  FAIL\033[0m %s\n' "$name" >&2
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
