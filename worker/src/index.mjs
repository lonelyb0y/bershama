/**
 * PharmaFlow nightly worker.
 *
 * WHY THIS EXISTS
 * ---------------
 * The application documents three nightly jobs. None of them had a scheduler:
 * docs/runbook.md tells an operator to check `cron.job_run_details`, and that
 * table was always empty, because nothing ever called the functions. The alert
 * centre was only ever populated when a warehouse manager pressed a button, and
 * the ledger reconciliation job -- the one that proves stock_balances agrees with
 * the append-only ledger -- had no production caller at all.
 *
 * This is that missing scheduler. It is deliberately small: the logic lives in
 * the database, where it is tested by pgTAP, and this only calls it.
 *
 * It is also deliberately boring. No framework, no queue, no retry library. A
 * job that raises 200 alerts should be re-run tomorrow, not retried in a tight
 * loop, and both database functions are idempotent, so a retry is harmless but
 * a retry storm is not.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Fail loudly and immediately: a misconfigured worker that exits 0 is worse. */
function required(name, value) {
  if (!value) {
    console.error(`FATAL: ${name} is not set. The worker cannot run without it.`);
    process.exit(78); // EX_CONFIG
  }
  return value;
}

/**
 * Call a Postgres function over PostgREST.
 *
 * PostgREST is the only path to the database on Supabase's free tier: port 5432
 * is not exposed, so pg_dump-style direct connections do not work. That is why
 * scripts/backup.sh goes through the REST API too.
 */
async function rpc(functionsApiPath, body = {}, { timeoutMs = 120_000 } = {}) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/${functionsApiPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${functionsApiPath}: ${text.slice(0, 400)}`);
    }
    return text ? JSON.parse(text) : null;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`${functionsApiPath} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Raise the low-stock / near-expiry / expired / overstock alerts.
 *
 * Delegates to api.run_alert_scan_for_tenant(), which resolves the tenant from a
 * constant in its own body. It is idempotent per (type, entity) while an alert
 * is open, so a re-run bumps `occurrences` instead of creating duplicates.
 */
async function runAlertScan() {
  const result = await rpc('run_alert_scan_for_tenant');
  const row = Array.isArray(result) ? result[0] : result;
  return { raised: row?.raised ?? 0, skipped: row?.skipped ?? 0 };
}

/**
 * Take the end-of-day stock snapshot.
 *
 * api.snapshot_stock() defaults p_snapshot_on to today, so passing nothing is
 * correct: a job that ran late at night must still snapshot the day it is
 * finishing, and an explicit date would be wrong after midnight.
 */
async function runSnapshot() {
  const result = await rpc('snapshot_stock', {});
  const row = Array.isArray(result) ? result[0] : result;
  return {
    snapshotOn: row?.snapshot_on ?? null,
    productsWritten: row?.products_written ?? 0,
  };
}

const JOBS = [
  { name: 'alert-scan', run: runAlertScan },
  { name: 'stock-snapshot', run: runSnapshot },
];

async function main() {
  required('SUPABASE_URL', SUPABASE_URL);
  required('SUPABASE_SECRET_KEY', SERVICE_KEY);

  const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
  const jobs = only ? JOBS.filter((j) => j.name === only) : JOBS;

  if (!jobs.length) {
    console.error(`FATAL: no job matches --only=${only}`);
    process.exit(64); // EX_USAGE
  }

  console.log(`[worker] starting; ${jobs.length} job(s); target ${SUPABASE_URL}`);

  let failed = 0;
  for (const job of jobs) {
    const startedAt = Date.now();
    try {
      const outcome = await job.run();
      console.log(
        `[worker] ${job.name} ok in ${Date.now() - startedAt}ms: ${JSON.stringify(outcome)}`,
      );
    } catch (err) {
      // One job failing must not stop the other. A missed snapshot is recoverable
      // by re-running; a missed alert scan delays a warning by a day.
      failed += 1;
      console.error(`[worker] ${job.name} FAILED after ${Date.now() - startedAt}ms: ${err.message}`);
    }
  }

  console.log(`[worker] finished; ${jobs.length - failed} ok, ${failed} failed`);
  // Non-zero so Render records the run as failed and the failure is visible.
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`[worker] unhandled: ${err?.stack ?? err}`);
  process.exit(70); // EX_SOFTWARE
});