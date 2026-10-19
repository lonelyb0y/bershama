#!/usr/bin/env bash
# Create or remove the browser suite's fixture.
#
# ── why the accounts are made here and not in the migration ─────────────────────
#
# api.ci_seed_fixture() creates the tenant, the roles and the stock. It does not create
# the auth users, and that is deliberate: a version that inserted auth.users rows itself
# seeded cleanly and produced accounts that could not be logged into. GoTrue answered
# invalid_credentials for users whose password hash, confirmation flag and identities
# were all correct — the failure is only visible by trying to sign in, so it survived a
# database test that checked every column it thought mattered.
#
# So the accounts are made here, through the Admin API, which is the supported path and
# the one the auth server participates in. The migration is handed the ids it returns.
#
# ── usage ──────────────────────────────────────────────────────────────────────
#
#   scripts/ci-fixture.sh seed      create the fixture, print its ids as JSON
#   scripts/ci-fixture.sh teardown  remove the fixture and its accounts
#
#   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY must be set. The password is fixed and
#   published in the job definition; it protects nothing, because these accounts exist
#   only between the two calls below.
set -euo pipefail

readonly ADMIN_EMAIL='ci-admin@pharmaflow.test'
readonly PHARMACY_EMAIL='ci-pharmacy@pharmaflow.test'
readonly DRIVER_EMAIL='ci-driver@pharmaflow.test'
readonly FIXTURE_PASSWORD="${FIXTURE_PASSWORD:-PharmaFlow#2026}"

log()  { printf '\033[1;34m==>\033[1m %s\n' "$*"; }
die()  { printf '\033[1;31m::error::%s\033[0m\n' "$*" >&2; exit 1; }

require_env() {
  local missing=0
  for name in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; do
    [ -n "${!name:-}" ] || { printf '::error::%s is not set.\n' "$name" >&2; missing=1; }
  done
  [ "$missing" -eq 0 ] || exit 1
}

# Create a confirmed account, or return the id of the existing one.
#
# Idempotent on purpose: a re-run after a crashed job must not fail on a user that is
# already there, and must not leave a duplicate behind.
ensure_user() {
  local email="$1" body id
  body="$(curl -fsS -X POST "$SUPABASE_URL/auth/v1/admin/users" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$FIXTURE_PASSWORD\",\"email_confirm\":true}")" \
    || die "could not create $email"

  id="$(printf '%s' "$body" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))')"

  if [ -z "$id" ]; then
    # Already exists. Look it up rather than treating it as an error.
    id="$(curl -fsS "$SUPABASE_URL/auth/v1/admin/users?page=1&per_page=200" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      | python3 -c "
import json, sys
target = sys.argv[1]
for u in json.load(sys.stdin).get('users', []):
    if (u.get('email') or '').lower() == target:
        print(u['id']); break
" "$email")" || die "$email does not exist and could not be created"
    [ -n "$id" ] || die "$email does not exist and could not be created"
  fi

  printf '%s' "$id"
}

delete_users() {
  local email="$1" id
  id="$(curl -fsS "$SUPABASE_URL/auth/v1/admin/users?page=1&per_page=200" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    | python3 -c "
import json, sys
target = sys.argv[1]
for u in json.load(sys.stdin).get('users', []):
    if (u.get('email') or '').lower() == target:
        print(u['id']); break
" "$email" || true)"
  [ -n "$id" ] || return 0
  curl -fsS -X DELETE "$SUPABASE_URL/auth/v1/admin/users/$id" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" >/dev/null || true
}

rpc() {
  curl -fsS -X POST "$SUPABASE_URL/rest/v1/rpc/$1" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "${2:-{\}}"
}

case "${1:-}" in
  seed)
    require_env
    log "creating accounts"
    admin="$(ensure_user "$ADMIN_EMAIL")"
    pharmacy="$(ensure_user "$PHARMACY_EMAIL")"
    driver="$(ensure_user "$DRIVER_EMAIL")"

    log "seeding the fixture"
    response="$(rpc ci_seed_fixture \
      "{\"p_admin\":\"$admin\",\"p_pharmacy\":\"$pharmacy\",\"p_driver\":\"$driver\"}")" \
      || die "the fixture failed to seed"

    printf '%s\n' "$response"

    # A fixture that raised no alerts cannot test the alert centre, and the suite would
    # report that as a broken page rather than a broken fixture.
    printf '%s' "$response" | grep -q '"alerts_raised": *[1-9]' \
      || die "the fixture seeded without raising an alert; alerts.spec.ts would fail for the wrong reason"
    log "fixture ready"
    ;;

  teardown)
    require_env
    # The database half first, then the accounts: that order leaves a window where the
    # accounts exist without a tenant, which is harmless — the reverse would leave a
    # tenant whose profiles point at users that have gone.
    log "removing the fixture tenant"
    rpc ci_teardown_fixture >/dev/null 2>&1 || true
    log "removing the accounts"
    delete_users "$ADMIN_EMAIL"
    delete_users "$PHARMACY_EMAIL"
    delete_users "$DRIVER_EMAIL"
    log "removed"
    ;;

  *)
    die "usage: scripts/ci-fixture.sh [seed|teardown]"
    ;;
esac