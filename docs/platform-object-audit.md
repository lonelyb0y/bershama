# Platform object audit

## What this is

`supabase/tests/rls_coverage.test.sql` runs in CI on every push and enforces a lot about
this database. It cannot see one class of object.

The CI suite runs against a throwaway cluster built from **this repository's migrations**.
Anything the Supabase platform installs itself — event triggers, its own functions in
`auth`, `extensions`, `graphql` — simply is not present in that cluster. There is nothing
local to assert it against, and a test that passes because its subject is absent is worse
than no test at all, because it reads as coverage.

That gap produced a real miss:

`public.rls_auto_enable()` — a `SECURITY DEFINER` function owned by **postgres**, created
with Postgres' default privileges rather than the ACL the platform grants its own event
triggers — held `EXECUTE` for `PUBLIC`, `anon`, `authenticated` and `service_role`. Any
anonymous caller could `POST /rest/v1/rpc/rls_auto_enable` and have it run as the
superuser owner.

It was never exploitable: as an event-trigger function, Postgres refuses a direct call
with `0A000 trigger functions can only be called as triggers` before the body runs. But
nothing in this repository could have found it. It took reading the Supabase security
advisor by hand, on the hosted project, one afternoon.

## What replaced branching

Database branching is the textbook fix: give CI a clone that *has* the platform objects,
and the existing assertions start biting on them. **It is deliberately not used.** It
bills monthly, and at this project's size a free audit that a person or a scheduled job
runs on demand is the better trade.

Two things now cover the gap, at no cost:

1. **`supabase/audit-platform-objects.sql`** — a read-only audit of platform-owned
   objects, written so it can be run against the live project from anything with SQL
   access. It creates nothing and changes nothing.
2. **`.github/workflows/advisors.yml`** — the Supabase security advisor, daily and on
   demand, compared against `supabase/advisor-baseline.json`. Free, but needs two
   repository secrets (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`); without them it
   skips with a visible notice rather than reporting green.

## The five checks

| # | Check | Catches |
|---|---|---|
| 1 | No `SECURITY DEFINER` function in an exposed schema is executable by `anon` | The finding above, as a property rather than a name |
| 2 | No `PUBLIC` `EXECUTE` on any definer function | The grant shape that let `anon` in, even where the role is separately revoked |
| 3 | No `SECURITY DEFINER` function with an unset `search_path` | Object shadowing to execute as the definer's owner |
| 4 | No RLS-free table in `public` or `api` | Default grants would make it world-readable |
| 5 | List any event-trigger definer `anon` can still reach | Informational — these are legitimate, but a *new* one should be visible in a diff |

Check 1 is the general form of the lesson: asserting on `rls_auto_enable` by name would
have been worthless, because the next one has a different name and the one after that sits
in a schema nobody thought to list.

## Result

Run against `kswdttkwtqqlabcjsgcy` on **2026-10-03**, via the Supabase MCP.

**Zero findings.** No rows, which is the passing state.

| Check | Result |
|---|---|
| anon reaches a definer | none |
| `PUBLIC` executes a definer | none |
| definer with mutable `search_path` | none |
| exposed table without RLS | none |
| event-trigger definer reachable by anon | none |

Spot-verified separately at the time: `public.rls_auto_enable()`'s ACL is now
`{postgres=X/postgres}`, and a table created immediately afterwards still had RLS enabled
by the `ensure_rls` trigger — so the revoke did not cost the trigger its behaviour.

## Honesty about what this record is worth

This is a **point-in-time** result, and that is the honest limit of it. It is not
continuous. A dated artefact is worth having precisely because it is dated and therefore
claims no more than it can prove — unlike a check that runs nowhere and reports green.

The three ways to make it continuous, in ascending order of cost:

1. Run `audit-platform-objects.sql` by hand before a release. Free, forgotten.
2. Add the two GitHub secrets so `advisors.yml` runs daily. Free.
3. Database branching, so CI itself sees platform objects. Monthly cost — declined.

Until one of those happens, this file plus the CI suite is the honest state: our objects
are guarded and that guard has been **proven to fail on demand** (a canary migration
creating an anon-executable definer was applied, `rls_coverage.test.sql` failed on exactly
that assertion, and the canary was removed). Platform objects are audited and dated.