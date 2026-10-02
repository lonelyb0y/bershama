import { NextResponse } from 'next/server';

import { getSession } from '@/lib/session';
import { createSupabaseAdminApiClient } from '@/lib/supabase/server';

/**
 * Re-arm the demo delivery run.
 *
 * ── why this exists ────────────────────────────────────────────────────────────
 *
 * The demo trip was seeded once, with a `run_date` that was "today" on the day it was
 * written and a fixed past date ever since. Two things quietly depended on that date
 * still being today:
 *
 *   * the driver's browser tests, which need a stop that is still PENDING to act on --
 *     two of them failed once the date rolled past the seed, with failures that said
 *     nothing about dates and read as the driver screen being broken;
 *   * the dashboard's "on the road today" panel, which correctly reported "No run is
 *     planned for today" -- true, and indistinguishable from a bug.
 *
 * So the run has to be re-armable on demand, and the browser suite has to be able to do
 * it without a credential it should not have. The alternative was a service-role key in
 * CI, writable from a pull request, purely to set a date. That is a far larger
 * capability than this, held in a worse place.
 *
 * ── why the check is here and not only in the function ─────────────────────────
 *
 * `api.reset_demo_run()` has its own warehouse-manager gate. It is not reachable by an
 * anonymous client because it lives in `api`, whose execute grants are enumerated by
 * `rls_coverage.test.sql`. This route adds the *session* check on top, because the call
 * below runs with the service key -- the service key has no profile row, so the
 * function's own `current_app_role()` is null and its gate cannot see who is asking.
 *
 * Without this check, any signed-in user could POST here and reset the demo run. It
 * only ever touches the demo tenant, so the blast radius is a demo, but a route that
 * ignores who is calling it is a bad habit to leave in a codebase.
 */

export async function POST() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ ok: false, error: 'not signed in' }, { status: 401 });
  }

  if (session.role !== 'WAREHOUSE_MANAGER' && session.role !== 'TENANT_ADMIN') {
    return NextResponse.json(
      { ok: false, error: `role ${session.role} may not re-arm the demo run` },
      { status: 403 },
    );
  }

  const supabase = createSupabaseAdminApiClient();
  const { data, error } = await supabase.rpc('reset_demo_run');

  if (error) {
    // The message is passed through: it comes from our own function, and "no demo run
    // in the demo tenant" is the answer to a support question.
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const row = data[0];

  return NextResponse.json(
    { ok: true, stopsReset: row.stops_reset, proofsRemoved: row.proofs_removed },
    { headers: { 'cache-control': 'no-store' } },
  );
}