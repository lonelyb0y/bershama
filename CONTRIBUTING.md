# Contributing

PharmaFlow moves medicine and records an audit trail of what happened to it. The
review bar reflects that.

## The rule that matters most

**Every table in `public` needs Row Level Security, and every migration that adds
one has to pass `rls_coverage.test.sql` before it merges.**

That test will fail until the RLS statement and the `revoke`/`grant` pair are
there. This is deliberate. The alternative failure mode is a table that ships
readable and writable by every signed-in user, and it does not announce itself.

## Setup

```bash
make install
make env            # .env.local, mode 600
make db             # local Supabase stack (needs Docker)
make dev
```

No Docker? `make test-db` runs the migrations and the suites against plain
PostgreSQL. See [docs/supabase-dev.md](docs/supabase-dev.md).

## Before opening a pull request

```bash
make verify
```

That is lint, typecheck, unit tests, the secret scan, migrations, 30 database
assertions, and a production build. It is what CI runs.

## Schema changes

The schema is defined in `supabase/migrations/` and nowhere else. Never edit a
hosted database directly — it makes the repository a lie.

Adding a table, in order:

1. `create table` with `tenant_id` and the constraints.
2. `revoke all on table … from anon, authenticated`.
3. `grant` back only the operations the client needs.
4. `alter table … enable row level security`.
5. Write policies. Always name the role: `to authenticated`. Use
   `(select private.current_tenant_id())` so the planner can hoist the call.
6. Add a test in `supabase/tests/`. Assert the allow case and the deny case.

Changing one of these? Check [ADR 0002](docs/adr/0002-rls-and-privileged-functions.md)
first — the schema split is a security boundary, not an organisation preference.

## Writing privileged code

Anything that needs to read or write across tenants is a `SECURITY DEFINER`
function, and those live in `private`:

- `set search_path = ''` on every one, and schema-qualify every name inside it.
- `revoke execute … from public`, then grant explicitly.
- Business logic goes in `private`; a thin `SECURITY INVOKER` wrapper goes in
  `api` for the client to call.
- Write the audit entry in the same transaction as the change. A trail that can
  drift from reality is worse than no trail.

CI fails if a `SECURITY DEFINER` function appears in `public` or `api`, or if a
`private` one loses its pinned `search_path`. Both are total losses of tenant
isolation, so neither is reviewable-and-fixable-later.

## Money

Integers of minor units. Never a float, never `numeric` for a totalled amount.
The conversion to major units happens once, in `lib/format.ts`, and the result is
never stored. If you need a new currency, add it to `CURRENCY_DECIMALS` **and**
say so in a PR description, because the storage decision assumes two decimals.

## Dates

`date` for an expiry date, `timestamptz` for an event. An expiry date means "the
last day this is usable", and the comparison is date-based at UTC midnight on
both sides — otherwise stock gets written off a day early or a day late.

Render in the tenant's timezone. Never store a naive timestamp.

## Text and RTL

Two locales, and the layout mirrors. Use logical properties
(`padding-inline`, `margin-inline`) — never `margin-left`. `dir` comes from the
locale, never from a component.

Numbers stay Latin on Arabic pages. A pharmacist transcribes an expiry date off a
carton.

## Tests

- **SQL**: pgTAP, against real Postgres. Never a mock — a mock cannot tell you a
  policy is wrong.
- **Denied writes**: assert the *reason* it was refused, not just that nothing
  happened. A missing grant raises `42501`; a `using` clause matching zero rows
  raises nothing. Those are different guarantees and the tests distinguish them.
- **Pure logic**: Vitest, with the boundary cases. The date arithmetic has a leap
  day test and an inclusive-expiry test because both have bitten.
- **End-to-end**: Playwright, for the flows a real user performs.

## Commit messages

Describe the change, not the mechanics.

```
Add FEFO allocation, skipping quarantined batches

allocate_requisition_fefo() orders eligible batches by expiry date
ascending and refuses any batch with less than the tenant's
min_shelf_life_pct remaining. Recalled and quarantined batches are
excluded before ordering rather than filtered after, so a shortage
message counts only allocatable stock.
```

## Decisions

Anything structural — a new schema, a new table, a change to the security
boundary, a dependency with a native build — gets an ADR in `docs/adr/` before
the code. Copy `docs/adr/README.md` for the template. An ADR must state its
costs; one without them is a press release.
