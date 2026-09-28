#!/usr/bin/env bash
#
# check-hosted-schemas.sh — is the `api` schema actually routed on the deployed
# project?
#
# The one check nothing else in this repository can do. See
# .github/workflows/hosted-schemas.yml for why it exists and why it runs against
# a project rather than a throwaway database.
#
# The call is unauthenticated on purpose. The check has to distinguish:
#
#   PGRST125 / PGRST202   the schema is not routed, or the function is missing.
#                         THIS is the bug, and this is what fails.
#   anything else         the schema is routed and the request was refused for
#                         want of a session, which is the correct behaviour.
#
# Asserting that the call *succeeds* would be wrong: it would need a live session
# against real data to prove something the negative already proves. Asserting the
# negative needs no session, no data, and no side effects.
#
# Exit: 0 routed (or skipped), 1 not routed.

set -uo pipefail

# Both spellings are accepted. The hosted values live in .env.local.hosted.bak under
# the NEXT_PUBLIC_ names the application itself uses, so requiring a second pair of
# names meant a developer with the right credentials on disk still got SKIPPED --
# which is how a check designed to catch a production failure ends up never
# running. CI passes HOSTED_*; a local run with `. .env.local.hosted.bak` works too.
URL="${HOSTED_SUPABASE_URL:-${NEXT_PUBLIC_SUPABASE_URL:-}}"
KEY="${HOSTED_SUPABASE_PUBLISHABLE_KEY:-${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:-}}"

# .env.local.hosted.bak holds a SERVICE key. Using it would bypass RLS and answer a
# different question than the one being asked: the check is about whether the schema
# is ROUTED, which is true or false for every role. The publishable key is used on
# purpose, and the fallback below exists only so a local run is still meaningful
# rather than silently wrong.
if [ -n "${SUPABASE_SECRET_KEY:-}" ] && [ -z "$KEY" ]; then
  echo "NOTE: only SUPABASE_SECRET_KEY is set; the service key bypasses RLS." >&2
fi

BLUE='\033[1;34m'
GREEN='\033[1;32m'
RED='\033[1;31m'
BOLD='\033[1m'
RESET='\033[0m'

if [ -z "$URL" ] || [ -z "$KEY" ]; then
  # A required check that cannot run is worse than no check: people learn to
  # ignore red. Skipped and green, with the reason stated.
  echo -e "${BLUE}SKIPPED${RESET} HOSTED_SUPABASE_URL / HOSTED_SUPABASE_PUBLISHABLE_KEY are not set."
  echo "         Add them as repository secrets to enable this check."
  exit 0
fi

echo -e "${BOLD}Checking that the deployed project routes the api schema${RESET}"
echo "  project: $(echo "$URL" | sed -E 's#(https://[a-z0-9]+\.).*#\1…#')"
echo

# `api.whoami` rather than a movement function, for two reasons: it takes no
# arguments, so there is nothing to get wrong in the request, and it is the
# function the sign-in path itself calls, so this is literally "can anyone log in".
# The profile headers, NOT a path prefix. `POST /rest/v1/api/rpc/whoami` is a
# 404 on this project even though the schema is served -- and even
# `/rest/v1/public/batches` is 404, so schema-qualified paths are not served at
# all. The headers are the documented mechanism and the one the application uses;
# see apps/web/src/lib/supabase/api-schema.ts.
BODY=$(curl -sS -m 20 -w '\n%{http_code}' \
  -X POST "${URL%/}/rest/v1/rpc/whoami" \
  -H "apikey: ${KEY}" \
  -H "Content-Type: application/json" \
  -H "Accept-Profile: api" \
  -H "Content-Profile: api" \
  -d '{}' 2>&1)

STATUS=$(echo "$BODY" | tail -n1)
PAYLOAD=$(echo "$BODY" | sed '$d')

echo "  HTTP ${STATUS}"
echo "  ${PAYLOAD}" | head -c 300
echo

if echo "$PAYLOAD" | grep -qE 'PGRST125|PGRST202|PGRST106'; then
  # Plain text, no colour: this output is read in a CI log, where escape codes
  # render as literal \033[1;31m and make a clear failure look like a script
  # error. The first version did exactly that.
  cat <<'EOF'

FAIL  the deployed project does not route the api schema.

  PGRST125 / PGRST202 means PostgREST cannot see the schema or the function.

  Two things have to be true, and only one of them lives in this repository:

    1. GRANT USAGE ON SCHEMA api TO authenticator, service_role
       -- migration 0012, in git, applied by `supabase db push`

    2. The project's exposed schemas must include 'api'
       -- a DASHBOARD setting, applied through the Management API, NOT in git.
          config.toml governs the local stack only.

  Check (2) first: it is the one nothing in CI verifies, and it is the one that
  produces this error.

  Until it is set, sign-in fails -- session.ts calls api.whoami -- and every
  stock and batch operation is unroutable.
EOF
  exit 1
fi

echo -e "${GREEN}  OK${RESET} the api schema is routed."
echo "      The request was refused for want of a session, which is the expected"
echo "      answer for an unauthenticated call and proves the route exists."
echo
echo "  Also confirming the boundary holds:"
printf "    Accept-Profile: private  -> HTTP %s  (406 means not served, which is correct)\n" \
  "$(curl -sS -o /dev/null -m 20 -w '%{http_code}' -X POST "${URL%/}/rest/v1/rpc/whoami" \
      -H "apikey: ${KEY}" -H "Content-Type: application/json" \
      -H "Accept-Profile: private" -H "Content-Profile: private" -d '{}')"
exit 0
