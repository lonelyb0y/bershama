# Runbook

Operating Bershama, and what to do when it breaks. Written for one person with
one phone.

## Daily

Nothing. The scheduled jobs handle it.

Check, if you have a moment:

1. Any `CRITICAL` alert. A ledger drift or an expired batch in active stock is
   not a notification, it is an incident.
2. Failed deliveries from the last 24 hours.
3. Whether `reconcile_stock_balances` ran. It should appear in the pg_cron job log
   every night. No entry means it did not run, and that is worth knowing before
   you trust a number.

## Reading an alert

| Type | Means | Do |
|---|---|---|
| `LOW_STOCK` | below the reorder point | order. If it happens repeatedly, the reorder point is wrong — adjust it rather than restocking harder |
| `NEAR_EXPIRY` | 90/60/30-day bucket | plan a return or a promotion **before** it reaches 30 days |
| `EXPIRED` | past expiry | quarantine, write off with a reason, then check whether the reorder policy caused it |
| `ORDER_OVERDUE` | past the needed-by date | contact the warehouse |
| `DELIVERY_FAILED` | the driver could not deliver | the stop has a reason code. Retrying without fixing the reason repeats the failure |
| `COLD_CHAIN_BREACH` | temperature out of range | **quarantine the affected batches first**, then investigate |
| `RECALL` | a batch is being withdrawn | follow the recall procedure; trace the lot both directions |
| Ledger drift | balance ≠ ledger sum | **stop adjusting stock manually.** This is the one alert that means the numbers cannot be trusted |

## Ledger drift: the alert that matters

The nightly job rebuilds every stock balance from the ledger and compares. A
difference means the materialised balance and the source of truth disagree.

**What it means:** a transaction is missing, double-applied, or the balance was
written outside `post_stock_movement()`. Until it is found, every stock number is
suspect and so is every allocation made from one.

**What to do:**

1. Do not hand-edit `stock_balances` to make the alert go away. That destroys the
   evidence of the cause.
2. Find the divergence: compare the balance to the summed ledger for that key.
3. Look for a missing or duplicated ledger row around the divergence.
4. If the balance is wrong and the ledger is right, correct it through the
   sanctioned path, with a reason, and expect an audit entry.
5. If the ledger is wrong, the correction is a compensating movement.

The one thing that makes this recoverable is that the ledger is append-only. The
cause is still there to be found.

## The database is paused

The free-tier project pauses after 7 days of low activity. A paused project is
**downtime**: drivers get nothing, and nobody can see a delivery.

1. Supabase dashboard → project → **Resume project**.
2. Wait for it to come back. Usually a minute.
3. Check whether a delivery was in progress when it paused. Offline-queued work
   replays on reconnect, so verify the stop list before assuming.
4. If it pauses again, upgrade to Pro. This is the third pause, not the first.

**Paused projects cannot be un-paused after 90 days on the free tier**, and their
backups cannot be updated while paused. If it has been paused a while, verify the
data is intact before relying on it.

## A delivery is not syncing

The driver is offline and work is queued.

1. Is the device online? Check the driver's connectivity, not the server.
2. Is the queued count climbing? The driver app shows it.
3. On reconnect it replays automatically. Each queued action carries an
   idempotency key, so a retry cannot double-deliver. **Do not tell a driver to
   re-do a delivery that is queued** — that is how a stock discrepancy gets
   created.
4. If it has been queued for more than an hour after connectivity returned, check
   whether the session expired. The driver must sign in again; queued work
   survives.

## A user cannot sign in

1. **Invite-only.** If the account does not exist, they need an invitation from a
   `TENANT_ADMIN`. This is expected, not a fault.
2. **Check the account is active.** `is_active = false` reads as "no session"
   everywhere, by design — deactivation is immediate.
3. **Check the profile exists and has a role.** A user in `auth.users` with no row
   in `profiles` can authenticate and then see nothing. This is a provisioning
   bug, not an auth bug.
4. **Email rate limit.** The free tier allows 2 emails/hour, so a password reset
   may simply not have been sent. This is fixed by custom SMTP, which is on the
   go-live checklist.

## A user sees nothing / a 404 on a dashboard

Expected behaviour for the wrong role. The route guard returns `notFound()` rather
than redirecting, deliberately: a user guessing `/admin` should not learn it
exists, and a real authorisation bug stays visible instead of being papered over
with a redirect.

Check `role` in `profiles`. If the role is right and the page still 404s, the
surface is not in `ROLES_BY_SURFACE` — which is a deliberate omission, not a bug.

## Deploying

```bash
git pull
make install
make check
make test-db
make build
```

Deployments are the Vercel Git integration. Migrations are **not** automatic:

```bash
make db-push        # prompts before touching the linked project
```

Read the migration before pushing it. `db-push` is interactive by design.

**Order matters.** Push migrations before or with the code that needs them, and
never deploy code that depends on a migration that has not been applied. A missing
column is a 500 on every page that touches it.

## Rolling back a deployment

Vercel: promote the previous deployment. Instant.

Migrations are not rolled back. Postgres has no transactional DDL rollback across
a release. The recovery is a **forward fix**: write a new migration that corrects
the schema. This is intentional — an append-only history of schema changes is
more auditable than a ledger of rollbacks — but it means a bad migration is
repaired, not undone.

## Backups

- **Pro:** daily backups plus PITR. Check the retention window matches what the
  business agreed.
- **Free:** no downloadable backup. Not a degraded mode — absent.

Test the restore. A backup that has never been restored is a hypothesis.

## Escalation

**Stock or data wrong:** stop manual adjustments. Preserve the ledger. Escalate
before correcting.

**Patient safety:** a wrong batch, a wrong quantity, or an expired item reached a
pharmacy. Treat as an incident, quarantine the lot, trace it in both directions,
and notify the distributor's responsible person. The system is not the
investigation.

**Security:** do not investigate in production. See [SECURITY.md](../SECURITY.md).
Rotate first, investigate after.

## Useful commands

```bash
make doctor        # what is available
make test-db       # are the migrations and policies still sound
make verify        # everything CI runs
make db-reset      # wipe and rebuild the local database
```

Inside the database:

```sql
-- recent jobs and their outcomes
select jobname, status, start_time, end_time
from cron.job_run_details
order by start_time desc limit 20;

-- has reconciliation been running?
select jobname, max(start_time) from cron.job_run_details
where jobname like '%reconcil%' group by jobname;

-- drift check, if reconciliation has not run
-- (compare a balance to its ledger sum)
```
