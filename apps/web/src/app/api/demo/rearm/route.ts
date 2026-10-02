import { NextResponse } from 'next/server';

import { getSession } from '@/lib/session';
import { getSupabaseApi } from '@/lib/supabase/server';

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
 * ── it calls as the caller, not as the service role ────────────────────────────
 *
 * The first version used `createSupabaseAdminApiClient()` -- the service key, BYPASSRLS
 * -- and it failed in production with "Missing environment variable
 * SUPABASE_SECRET_KEY", because production has never had that variable: the rest of the
 * application does not need it. Every other write in this app goes through the signed-in
 * user's own session, and there is no reason for this one to be different.
 *
 * Calling as the caller is also *stronger*, not weaker. `api.reset_demo_run()` is
 * SECURITY DEFINER and has its own warehouse-manager gate which reads the caller's role
 * out of the session. Behind the service key that gate saw a null role -- "this is the
 * service role, allow it" -- so the route had to re-implement the role check itself,
 * and the function's own was bypassed. Called this way, the database enforces the same
 * rule as every other warehouse write, and the check below is defence in depth rather
 * than the only thing standing there.
 *
 * It also means this route needs no privileged credential to exist at all.
 */

export async function POST() {
  // Everything below can throw, and a thrown handler in a route returns a bare 500 with
  // an empty body -- which told me nothing when this route started failing in
  // production. A JSON error naming the cause is worth the three lines.
  try {
    return await rearm();
  } catch (error) {
    console.error('[demo/rearm] threw', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

async function rearm() {
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

  // The caller's own session, through the same `api`-schema client the rest of the
  // application uses. `getSupabaseApi()` is bound to the request cookies.
  const supabase = await getSupabaseApi();
  const { data, error } = await supabase.rpc('reset_demo_run');

  if (error) {
    // The message is passed through: it comes from our own function, and "no demo run
    // in the demo tenant" is the answer to a support question.
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // `data?.[0]` rather than `data[0]`. PostgREST returns an empty array rather than a
  // row when a `returns table` function matches but yields nothing, and indexing that
  // is the exception that produced the empty 500.
  const row = data?.[0];

  return NextResponse.json(
    {
      ok: true,
      stopsReset: row?.stops_reset ?? 0,
      proofsRemoved: row?.proofs_removed ?? 0,
      // Loud when it happens: the demo run going missing is a data problem, and a
      // silent "0 stops reset" reads like a success that did nothing.
      ...(row ? {} : { warning: 'the demo run returned no rows' }),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}