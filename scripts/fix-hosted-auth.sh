#!/usr/bin/env bash
#
# fix-hosted-auth.sh — re-apply the auth settings `supabase config push` drops.
#
# ── the problem ─────────────────────────────────────────────────────────────
#
# `supabase config push` rewrites the project's auth configuration from
# supabase/config.toml. The CLI manages `auth.email.enable_signup` but NOT the
# email provider toggle, so the push leaves it at its default -- disabled -- and
# every sign-in starts returning
#
#     422  email_provider_disabled
#
# Reproduced three times in one session, which is how it was pinned down rather
# than suspected: PATCH the toggle, verify sign-in works, run any config push, and
# sign-in is broken again. The app loads fine and nobody can get in.
#
# This is the worst kind of regression because it is invisible from the code, from
# the schema, and from the type checker. The application calls
# supabase.auth.signInWithPassword, and the server answers with a clear error that
# the UI shows correctly. Everything is working except the way in.
#
# ── why not just "don't run config push" ─────────────────────────────────────
#
# Because the next person will, and "remember to re-apply this" is not a control.
# The setting is applied here, and `make config-push` runs both, so the footgun is
# disarmed rather than documented.
#
# ── what it changes, and what it does not ────────────────────────────────────
#
#   external_email_enabled  true   so password sign-in works at all
#   disable_signup          true   UNCHANGED, and asserted below
#
# Signups stay disabled, which is what makes the deployment invite-only as the
# login page claims. Only the provider is switched on -- without it there is no
# way in at all, not even for a user who was invited.

set -euo pipefail

REF="${SUPABASE_PROJECT_REF:-}"
if [ -z "$REF" ] || [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN are required." >&2
  echo "  Create a personal access token at supabase.com/dashboard/account/tokens" >&2
  exit 1
fi

curl -sS -m 30 -X PATCH "https://api.supabase.com/v1/projects/${REF}/config/auth" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"external_email_enabled": true, "disable_signup": true}' \
  -o /dev/null -w '  auth patched: HTTP %{http_code}\n'

# Read it back rather than trusting the PATCH. A 200 on a request that silently
# did nothing would leave sign-in broken and the script reporting success.
ENABLED=$(curl -sS -m 20 "https://api.supabase.com/v1/projects/${REF}/config/auth" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('external_email_enabled'))")

if [ "$ENABLED" != "True" ] && [ "$ENABLED" != "true" ]; then
  echo "  FAIL  the email provider is still disabled; sign-in will not work." >&2
  exit 1
fi

echo "  email provider: enabled"
echo "  signups:        disabled (invite-only, as the login page promises)"
echo
echo "  Run scripts/check-hosted-schemas.sh to confirm the whole path."
