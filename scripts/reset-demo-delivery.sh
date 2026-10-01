#!/usr/bin/env bash
# ============================================================================
# reset-demo-delivery.sh — put the demo tenant's delivery run back to a state a
# reviewer can actually look at.
#
# WHY THIS EXISTS
#
# The demo run is a real run in a real database, and anything that works the stops
# consumes it: once both stops are DELIVERED the driver screen opens onto a finished
# run, the map has nothing to plot, and the sign sheet is unreachable. That happened
# during M4 testing and left the hosted demo showing a closed run.
#
# HOW IT WORKS, AND WHY IT CALLS A FUNCTION
#
# This calls api.reset_demo_run() rather than writing the tables with the
# service key. That was not the first implementation and the first one was wrong:
# writing delivery_stops.status needs USAGE on the private schema, because the
# column's type is private.stop_status and naming a type means naming its schema.
# Granting service_role that USAGE made the script work and broke an invariant the
# RLS suite asserts on purpose -- "service_role cannot see the private schema" -- so
# 0049 granted it and 0050 took it straight back.
#
# maintenance.reset_demo_run is a SECURITY DEFINER function in a schema no HTTP role
# can name, scoped to the demo tenant by constant rather than by argument. The script
# therefore cannot be pointed at a customer's deliveries even by accident, and the
# private schema stays sealed. 0051 asserts both of those.
#
# Usage:  scripts/reset-demo-delivery.sh
# Needs:  NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in the environment.
#         Source .env.local.hosted.bak first.
# ============================================================================
set -euo pipefail

: "${NEXT_PUBLIC_SUPABASE_URL:?set NEXT_PUBLIC_SUPABASE_URL}"
: "${SUPABASE_SECRET_KEY:?set SUPABASE_SECRET_KEY}"

AUTH=(-H "apikey: $SUPABASE_SECRET_KEY" -H "Authorization: Bearer $SUPABASE_SECRET_KEY")
BASE="$NEXT_PUBLIC_SUPABASE_URL/rest/v1"

curl -s -X POST "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -H "Accept-Profile: api" -H "Content-Profile: api" \
  "$BASE/rpc/reset_demo_run" -d '{}' \
  | python3 -c "
import json, sys

payload = json.load(sys.stdin)

if isinstance(payload, dict) and payload.get('code'):
    raise SystemExit(f\"  reset refused: {payload.get('code')} {payload.get('message')}\")

if not payload:
    raise SystemExit('  no result returned -- is the maintenance schema reachable?')

row = payload[0]
print(f\"  stops reset: {row['stops_reset']}, proofs removed: {row['proofs_removed']}\")
print('  demo run is back to: stop 1 ARRIVED (with position), stop 2 PENDING, trip IN_TRANSIT')
"
