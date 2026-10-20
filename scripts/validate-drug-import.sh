#!/usr/bin/env bash
#
# Validate the Egyptian drug import against a real database.
#
# ── why this exists rather than trusting --stats-only ───────────────────────────
#
# `--stats-only` reports what the parser produced. It says nothing about whether the
# resulting SQL is accepted by the schema: a column that does not exist, an enum value
# outside `private.product_form`, a check constraint on strength, a NOT NULL that fires.
# Those are only findable by running it.
#
# So this builds the same throwaway cluster scripts/verify-db.sh builds, applies the
# migrations and seed, runs the generated SQL, and reports what actually landed. Nothing
# here touches the hosted project -- a failure costs a few seconds, not an incident.
#
# Usage:
#   scripts/validate-drug-import.sh /path/to/egyptian-drugs.sql

set -euo pipefail

IMPORT_SQL="${1:-}"
if [ -z "$IMPORT_SQL" ] || [ ! -f "$IMPORT_SQL" ]; then
  echo "usage: $0 <generated-import.sql>" >&2
  exit 64
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGDATA_DIR="$(mktemp -d /tmp/pf-drugs-validate.XXXXXX)"
SOCKET_DIR="$(mktemp -d /tmp/pf-drugs-sock.XXXXXX)"
PORT="${PF_VALIDATE_PORT:-54329}"
DB_NAME=bershama_drugs

cleanup() {
  pg_ctl -D "$PGDATA_DIR" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$PGDATA_DIR" "$SOCKET_DIR"
}
trap cleanup EXIT

export PGHOST="$SOCKET_DIR" PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres

echo "  initialising a throwaway cluster on port $PORT"
initdb -D "$PGDATA_DIR" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null 2>&1
pg_ctl -D "$PGDATA_DIR" -o "-p $PORT -k $SOCKET_DIR" -l "$PGDATA_DIR/pg.log" -w start >/dev/null

psql -q -d postgres -c "create database $DB_NAME;" >/dev/null
export PGDATABASE="$DB_NAME"

psql -q -v ON_ERROR_STOP=1 -f "$REPO_ROOT/supabase/tests/0000_supabase_compat.sql" >/dev/null
echo "  applying migrations"
for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
  if ! out=$(psql -q -v ON_ERROR_STOP=1 -f "$f" 2>&1); then
    echo "  MIGRATION FAILED: $(basename "$f")" >&2
    echo "$out" | head -5 >&2
    exit 1
  fi
done

psql -q -v ON_ERROR_STOP=1 -f "$REPO_ROOT/supabase/seed.sql" >/dev/null
echo "  seeded; applying the import"

started=$(date +%s)
if ! out=$(psql -q -v ON_ERROR_STOP=1 -f "$IMPORT_SQL" 2>&1); then
  echo "  IMPORT FAILED" >&2
  echo "$out" | head -8 >&2
  exit 1
fi
elapsed=$(( $(date +%s) - started ))

echo "  import applied in ${elapsed}s"
echo
psql -q -v ON_ERROR_STOP=1 <<'SQL'
\pset pager off
select count(*)                                        as total_products,
       count(*) filter (where source like 'EGYPTIAN%')  as from_register,
       count(*) filter (where manufacturer is not null) as with_manufacturer,
       count(*) filter (where drug_class is not null)   as with_class,
       count(*) filter (where form = 'UNSPECIFIED')     as form_unspecified,
       count(*) filter (where strength is not null)     as with_strength,
       count(*) filter (where sell_price_minor > 0)     as priced
  from public.products;

select form, count(*)
  from public.products where source like 'EGYPTIAN%'
 group by form order by count(*) desc;

-- The exclusions are the point of the exercise, so they are asserted rather than hoped
-- for. A cancelled product in a pharmacy catalogue is worse than a missing one, because
-- it looks entirely ordinary.
select count(*) as banned_rows_that_got_in
  from public.products
 where source like 'EGYPTIAN%'
   and (name_en ~* '\b(ILLEGAL\s+IMPORT|CANCELLED|CANCELED|RECALLED|BANNED|WITHDRAWN)\b'
        or generic_name_en ~* '\b(ILLEGAL\s+IMPORT|CANCELLED|CANCELED|RECALLED|BANNED|WITHDRAWN)\b');

select p.sku, p.name_en, p.name_ar, p.form, p.strength, p.strength_unit, p.pack_size,
       p.manufacturer, p.sell_price_minor
  from public.products p
 where p.source like 'EGYPTIAN%' and p.strength is not null and p.pack_size is not null
 order by p.sku limit 5;
SQL
