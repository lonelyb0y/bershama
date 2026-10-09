#!/usr/bin/env bash
# Regenerate database.types.ts from a throwaway cluster built from the migrations.
#
# ── why not `supabase gen types --project-id` ───────────────────────────────────────
#
# Because it needs a personal access token, and access tokens expire. Two things go wrong
# when one lapses, and both are nasty:
#
#   * `make types` redirects the CLI's stdout straight into database.types.ts, so a failed
#     generation writes a 153-byte JSON error document over the previous good file;
#   * check-api-types.py then reports every api function as missing, and typecheck, lint
#     and the build all fail -- which reads exactly like a schema that has collapsed rather
#     than like a credential that stopped working.
#
# This script generates to a temporary file and only moves it into place after checking the
# output is TypeScript. A failed run leaves the committed types untouched.
#
# ── why the local cluster is the better source anyway ───────────────────────────────
#
# Because the migrations are the source of truth. Hosted is derived from them: every change
# is written as a migration, applied locally by verify-db.sh, and applied to the project
# through the MCP. Generating from a database built purely from migrations therefore
# describes the schema that is *supposed* to exist.
#
# It also takes the credential out of the loop entirely. No token, no expiry, no failure
# mode that destroys a committed file.
#
# ── the re-indent, and why it is needed ─────────────────────────────────────────────
#
# The CLI emits a different shape depending on where the schema came from. From
# --project-id, api function keys sit at a consistent indent with `{ Args:` on the same
# line. From --db-url they do not: some keys land at column 0 and some twelve spaces in,
# and some have the value on the following line.
#
# All of it is valid TypeScript, so nothing "fails" -- but database.types.ts is committed
# and parsed by check-api-types.py, and a file with mixed indentation is both unreadable and
# ambiguous to parse. So this normalises: unquote keys, rejoin a key with a value that
# wrapped onto the next line, and put every api function key at one depth.
#
# The re-indent is a bounded transform -- only lines matching `name: { Args:` *inside the api
# Functions block* are touched, and only their leading whitespace is rewritten. Nothing
# inside a function body is re-indented, because nesting there is meaningful.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/apps/web/src/lib/database.types.ts"

DATA="$(mktemp -d /tmp/pf-types-d.XXXXXX)"
SOCK="$(mktemp -d /tmp/pf-types-s.XXXXXX)"
PORT="${TYPES_PGPORT:-54377}"
DB="types"
trap 'pg_ctl -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA" "$SOCK"' EXIT

initdb -D "$DATA" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -l "$DATA/pg.log" -w start >/dev/null
createdb -h "$SOCK" -p "$PORT" -U postgres "$DB"

export PGHOST="$SOCK" PGPORT="$PORT" PGUSER=postgres PGDATABASE="$DB"
psql -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/0000_supabase_compat.sql" >/dev/null
psql -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/pgtap_shim.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done
# `auth` exists only on hosted. A stub keeps generation happy without pretending to describe
# something this cluster does not have.
psql -q -v ON_ERROR_STOP=1 -c "
  create schema if not exists auth;
  create table if not exists auth.users (
    id uuid primary key, email text, created_at timestamptz default now()
  );" >/dev/null 2>&1 || true

TMP="$(mktemp)"

# A host must be present even over a unix socket: `postgres@/db` fails to parse, and the
# error names the parsing rather than the socket.
if ! supabase gen types typescript \
      --db-url "postgresql://postgres@localhost:${PORT}/${DB}?host=${SOCK}" > "$TMP" 2>/tmp/pf-types-err.log; then
  echo "  generation failed; database.types.ts left untouched" >&2
  head -c 500 /tmp/pf-types-err.log >&2
  exit 1
fi

# Guard rather than hope. Substance, not shape: a real file is large and contains the
# Functions block the checker parses.
if [ "$(wc -c < "$TMP")" -lt 20000 ] || ! grep -q 'Functions:' "$TMP"; then
  echo "  generated output does not look like generated types; refusing to overwrite" >&2
  head -c 400 "$TMP" >&2
  exit 1
fi

python3 - "$TMP" <<'NORMALISE'
import re, sys

path = sys.argv[1]
text = open(path, encoding="utf-8").read()

# 1. Rejoin a key whose value wrapped onto the next line, and unquote it.
#    `"name"?:\n{ Args:` -> `name?: { Args:`
#
#    The optional-parameter marker sits *before* the closing quote (`"p_note"?:`), so it is
#    captured and re-emitted rather than assumed absent. One regex, not two: an earlier
#    version of this script used two, and one had a stray `)` inside its character class so
#    it matched nothing. Between them they rejoined 2 of 48 entries while reporting success,
#    which is the worst kind of almost-right.
text = re.sub(r'"([A-Za-z_][A-Za-z0-9_]*)"(\??)\s*:\s*\n\s*\{', r"\1\2: {", text)

# 2. Unquote the remaining keys. Safe on index expressions like Database["public"] because
#    both patterns require a colon, which those never have.
text = re.sub(r'"([A-Za-z_][A-Za-z0-9_]*)"(\??)\s*:', r"\1\2:", text)

# 3. Put every function entry at one depth.
#
#    Deliberately global rather than scoped to a hand-located api block. An earlier version
#    tried to delimit the block by searching for `      api: {` and `      public: {`, which
#    is wrong twice over on this output: they are indented by two spaces, and there are two
#    `api: {` blocks -- one per schema -- so the search anchored on the wrong one and
#    re-indented two entries out of fifty.
#
#    The transform is safe without any delimiting because nothing *inside* a function body
#    begins with `name: { Args:`. `Args`, `Returns` and `SetofOptions` are nested blocks with
#    their own indentation, and none of them is followed by another `Args:` on the same
#    line. So a global rewrite touches function entries and nothing else, and there is no
#    block boundary to get wrong.
text = re.sub(
    r"(?m)^[ \t]*([A-Za-z_][A-Za-z0-9_]*): \{ Args:", r"      \1: { Args:", text
)

open(path, "w", encoding="utf-8").write(text)
NORMALISE

mv "$TMP" "$OUT"
echo "  wrote $OUT ($(wc -c < "$OUT") bytes) from $(ls "$ROOT"/supabase/migrations/*.sql | wc -l) migrations"
