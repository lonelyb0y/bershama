#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# ledger-smoke.sh — exercise the ledger and its balance trigger outside pgTAP.
#
# Why this exists alongside the pgTAP suites: the pgTAP suites assert behaviour
# through the api.* surface as a signed-in user, which is the path production
# takes. This script drives the same invariants from the table level, with no
# session, to prove two things the suites cannot:
#
#   1. the AFTER INSERT trigger maintains the balance even when a ledger row is
#      inserted directly with no function involved. If the trigger were the
#      function's job rather than the trigger's, this would show a balance of 0.
#   2. an outbound movement past zero is refused by the CHECK and the ledger row
#      rolls back with it, so nothing is recorded.
#
# Usage: scripts/ledger-smoke.sh [port]
# ---------------------------------------------------------------------------
set -euo pipefail

PORT="${1:-55450}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGDATA_DIR="$(mktemp -d /tmp/pf-ledger-smoke.XXXXXX)"
SOCKET_DIR="$(mktemp -d /tmp/pf-ledger-sock.XXXXXX)"

export PGHOST="$SOCKET_DIR" PGPORT="$PORT" PGUSER=postgres PGDATABASE=pharmaflow_smoke

pass=0; fail=0
ok()   { printf '\033[1;32m  ok\033[0m %s\n' "$*"; pass=$((pass+1)); }
bad()  { printf '\033[1;31m  FAIL\033[0m %s\n' "$*"; fail=$((fail+1)); }
check(){ if [ "$1" = "$2" ]; then ok "$3 (= $2)"; else bad "$3 (expected $2, got $1)"; fi; }

cleanup() { pg_ctl -D "$PGDATA_DIR" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$PGDATA_DIR" "$SOCKET_DIR"; }
trap cleanup EXIT

initdb -D "$PGDATA_DIR" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null 2>&1
pg_ctl -D "$PGDATA_DIR" -o "-p $PORT -k $SOCKET_DIR" -l "$PGDATA_DIR/pg.log" -w start >/dev/null
psql -q -d postgres -c "create database pharmaflow_smoke;" >/dev/null

psql -q -v ON_ERROR_STOP=1 -f "$REPO_ROOT/supabase/tests/0000_supabase_compat.sql" >/dev/null
for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null || { bad "migration $(basename "$f")"; exit 1; }
done

T='aaaaaaaa-0000-4000-8000-000000000001'
F='f0000000-0000-4000-8000-000000000001'
L='10000000-0000-4000-8000-000000000001'
P='20000000-0000-4000-8000-000000000001'
B='30000000-0000-4000-8000-000000000001'

psql -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
insert into public.tenants (id, slug, name_en, name_ar)
values ('$T','smoke','Smoke Co','شركة سميوك');
insert into public.facilities (id, tenant_id, kind, code, name_en, name_ar)
values ('$F','$T','WAREHOUSE','WH','Warehouse','المستودع');
insert into public.storage_locations (id, tenant_id, facility_id, kind, code, name_en, name_ar)
values ('$L','$T','$F','AMBIENT','A1','Ambient A1','عادي أ1');
insert into public.products (id, tenant_id, sku, name_en, name_ar, form, strength, pack_size, uom, shelf_life_months)
values ('$P','$T','SKU-1','Panadol Extra 500mg','بنادول إكسترا 500 مجم','TABLET','500mg',20,'BOX',24);
-- The batch's implied shelf life must sit within the product's declared 24 months.
-- An earlier version of this fixture declared 36 months for a one-year batch and the
-- shelf_life_implausible check refused it, which is the check working as intended.
insert into public.batches (id, tenant_id, product_id, lot_number, mfg_date, expiry_date, unit_cost_minor, status)
values ('$B','$T','$P','LOT-1','2026-01-15','2028-01-15',4500,'RELEASED');
SQL

ins() { # qty txn -> returns non-zero on refusal, with the server's message on stdout
  psql -q -v ON_ERROR_STOP=1 -c \
    "insert into public.stock_ledger (tenant_id, facility_id, location_id, product_id, batch_id, qty_delta, txn_type, unit_cost_minor)
     values ('$T','$F','$L','$P','$B',$1,'$2',4500);" 2>&1 | grep -v '^INSERT 0' | grep -v '^$'
  return "${PIPESTATUS[0]}"
}

# An insert that is EXPECTED to succeed. Under `set -e` a bare call would abort
# the whole script on the first refusal, so the status is captured explicitly and
# reported as a failed check with the reason, instead of the run ending with no
# output and a bare exit 1.
ins_ok() {
  local out
  if ! out="$(ins "$1" "$2" 2>&1)"; then
    bad "$3: refused — $out"
    return 1
  fi
  ok "$3"
}
bal() { psql -tA -c "select coalesce(qty_on_hand,-999) from public.stock_balances;" 2>/dev/null | tr -d ' '; }
ledger_sum() { psql -tA -c "select coalesce(sum(qty_delta),0) from public.stock_ledger;" | tr -d ' '; }
ledger_rows() { psql -tA -c "select count(*) from public.stock_ledger;" | tr -d ' '; }

echo "── trigger maintains the balance with no function involved ──"
ins_ok 240 RECEIPT "RECEIPT of +240 is accepted"
check "$(bal)" "240" "balance after a direct ledger insert of +240"
check "$(ledger_rows)" "1" "one ledger row recorded"

ins_ok -40 ISSUE "ISSUE of -40 is accepted"
check "$(bal)" "200" "balance accumulates a -40 issue"

echo
echo "── balance always equals the sum of the ledger ──"
check "$(bal)" "$(ledger_sum)" "balance == sum(ledger)"

echo
echo "── outbound past zero is refused, and records nothing ──"
before_rows="$(ledger_rows)"; before_bal="$(bal)"
if ins -9999 ISSUE; then
  bad "an issue of -9999 against a balance of 200 was ACCEPTED"
else
  ok "an issue of -9999 against a balance of 200 was refused"
fi
check "$(ledger_rows)" "$before_rows" "no ledger row was added by the refused movement"
check "$(bal)" "$before_bal" "balance unchanged by the refused movement"

echo
echo "── outbound to exactly zero is allowed ──"
ins_ok -200 ISSUE "ISSUE down to exactly zero is accepted"
check "$(bal)" "0" "balance may reach exactly zero"
check "$(bal)" "$(ledger_sum)" "balance == sum(ledger) at zero"

echo
echo "── ledger is append-only ──"
if psql -q -c "update public.stock_ledger set qty_delta = 9999;" >/dev/null 2>&1; then
  bad "UPDATE on stock_ledger was ALLOWED"
else
  ok "UPDATE on stock_ledger is refused"
fi
if psql -q -c "delete from public.stock_ledger;" >/dev/null 2>&1; then
  bad "DELETE on stock_ledger was ALLOWED"
else
  ok "DELETE on stock_ledger is refused"
fi

echo
echo "── the sign rule binds qty_delta to txn_type ──"
if psql -q -c "insert into public.stock_ledger (tenant_id, facility_id, location_id, product_id, batch_id, qty_delta, txn_type) values ('$T','$F','$L','$P','$B',-50,'RECEIPT');" >/dev/null 2>&1; then
  bad "a NEGATIVE RECEIPT was accepted"
else
  ok "a negative RECEIPT is refused"
fi
if psql -q -c "insert into public.stock_ledger (tenant_id, facility_id, location_id, product_id, batch_id, qty_delta, txn_type) values ('$T','$F','$L','$P','$B',50,'ISSUE');" >/dev/null 2>&1; then
  bad "a POSITIVE ISSUE was accepted"
else
  ok "a positive ISSUE is refused"
fi
if psql -q -c "insert into public.stock_ledger (tenant_id, facility_id, location_id, product_id, batch_id, qty_delta, txn_type) values ('$T','$F','$L','$P','$B',0,'ADJUSTMENT');" >/dev/null 2>&1; then
  bad "a ZERO-qty movement was accepted"
else
  ok "a zero-quantity movement is refused"
fi

echo
echo "── reserved cannot exceed on hand ──"
if psql -q -c "update public.stock_balances set qty_reserved = qty_on_hand + 1 where tenant_id = '$T';" >/dev/null 2>&1; then
  bad "over-reservation was accepted"
else
  ok "reserved > on_hand is refused"
fi

echo
if [ "$fail" -eq 0 ]; then
  printf '\033[1;32mAll %d ledger smoke checks passed.\033[0m\n' "$pass"
else
  printf '\033[1;31m%s of %s checks failed.\033[0m\n' "$fail" "$((pass+fail))"
  exit 1
fi
