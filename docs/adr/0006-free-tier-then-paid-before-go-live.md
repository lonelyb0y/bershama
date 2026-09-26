# 0006. Free tiers while learning, paid before production

Status: Accepted

## Context

The project is being built by one person, without capital, for a company that
wants to use it in production. Those two facts pull in opposite directions, and
the honest resolution is to separate them in time rather than pretend the tension
does not exist.

Free-tier limits found during research, and what each one actually means here:

| Limit | Free tier | Consequence |
|---|---|---|
| Project pausing | Paused after 7 days of low activity | A paused project is downtime on a delivery day. Once paused, backups cannot be updated. |
| Database backups | **Not available for download** | No backup you can export or verify. This is the serious one. |
| Point-in-time recovery | Pro only | Cannot recover to a point in time, only to a daily snapshot. |
| Auth email rate | 2 emails/hour | Invite-based onboarding breaks past two users. |
| Custom email templates | Locked on free | Branded auth emails unavailable. |
| Database size | 0.5 GB | Fine for a pilot; a limit at a few hundred thousand ledger rows. |
| Storage | 1 GB | POD photos are the consumer. Fine for a pilot. |
| Realtime | 200 connections, 2M messages/mo | Fine for a handful of drivers. |
| Vercel Hobby | **Non-commercial use only** | A terms-of-service breach the moment a distributor's revenue flows through it. |

The Vercel restriction is categorically different from the others. Every Supabase
limit is a capacity or availability problem. Using Hobby for a commercial
business is a contractual one, and it is the distributor's business, not a
hobby.

## Decision

**Build and pilot entirely on free tiers. Move to paid plans before any real
stock, revenue or patient-safety dependency exists.**

Specifically, M6 is a go-live gate:

- **Supabase Pro ($25/mo)** — required before production. Removes pausing, adds
  downloadable backups and PITR.
- **Vercel Pro ($20/mo)** — required before production. Hobby is
  non-commercial by terms.
- **Custom SMTP** — required before onboarding more than a couple of users.
- **A restore drill** — restoring a backup and verifying the data, before
  go-live. A backup nobody has restored from is not a backup.

Before that, an hourly `pg_cron` keep-alive reduces the risk of an inactivity
pause, and is removed once Pro is enabled. It is a mitigation, not a fix, and is
commented as such in the migration that creates it.

## Consequences

### Positive

- **Zero cost while learning.** The expensive part of this project is the
  iteration, and it happens before anyone is depending on it.
- **The free limits force honest scope.** No optimisation for a scale that does
  not exist yet.
- **The upgrade decision is forced at the right moment.** When a distributor is
  about to rely on it, the cost is justified by a real dependency rather than
  anticipated.

### Negative

- **A real risk of losing data before Pro.** This is the part that cannot be
  engineered away on the free tier. The mitigation is the rule that no real stock
  or revenue flows through before M6 is complete, and that rule has to be
  enforced by discipline rather than by the system.
- **Plausible deniability is a real failure mode.** "The database was paused" is
  an explanation a distributor will accept, which is exactly what makes it
  dangerous. Documented in the runbook as a known risk.
- **The upgrade is a production change under time pressure.** Discovering the need
  for PITR while restoring from a daily dump is a bad moment to be configuring
  backups.
- **$45/mo is not nothing** for a company at the start. It is the price of not
  having an outage, and it is cheaper than one hour of a driver waiting for a
  delivery that the system cannot tell him to make.

### Neutral

- **The schema is portable.** Plain Postgres, so moving off Supabase is a dump
  and a restore. What does not port is Auth, Realtime, Storage and Cron, and that
  is the real lock-in.
- **The cost is known in advance.** Both numbers are published and stable, so the
  decision is not an open-ended commitment.
