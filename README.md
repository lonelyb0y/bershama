# PharmaFlow

Pharmaceutical supply chain platform for a medicine distribution company.
Batch-level inventory with lot and expiry control, requisitions, live delivery
tracking, and an audit trail that survives an auditor.

Built for an operator in Egypt: bilingual English/Arabic with full RTL, EGP
denominated, WHO GDP-aligned batch traceability.

**Status: M0-M4 complete, M5 partially (alert centre, dashboards, analytics and self-serve signup shipped; reorder policies and snapshots not started).** The
catalogue, batches and append-only stock ledger are built and tested. The CRUD
screens, requisitions and delivery tracking are not. See [Roadmap](#roadmap).

---

## The problem

A distributor moving medicine from a warehouse to pharmacies has to answer four
questions continuously:

1. **What do I have?** By batch, not just by product. Panadol lot A123 expires in
   March; lot B456 expires in November. A quantity without a lot number is
   useless.
2. **What is about to expire?** Stock that expires in a pharmacy's back room is a
   write-off the distributor ends up paying for.
3. **What did each pharmacy ask for, and did it arrive?**
4. **Where are my drivers right now?**

Paper and spreadsheets answer these questions a week late. This answers them now,
and records every movement in a form that survives scrutiny.

## Design principles

These shaped more decisions than the feature list did.

**The ledger is append-only.** Every stock movement is an immutable row.
Corrections are new compensating rows, never edits. A batch is never hard
deleted — only moved between `RELEASED`, `QUARANTINED` and `RECALLED`, always
with a reason. This is what makes the history defensible, and it is enforced by a
database trigger rather than by discipline.

**Money is never a float.** Every amount is an integer count of piastres
(1 EGP = 100), from the database column to the rendered string. Division happens
once, at display time. A ledger that has passed through a float will eventually
disagree with physical stock by one piastre, and "the system says we are 0.01
short" is not an answer you can give a pharmacist.

**The database enforces who you are.** Supabase Row Level Security, not
application middleware. A bug in a request handler cannot leak another
company's stock, because the query itself returns nothing. The tenant id is
never read from a URL or a header — it comes from the session, inside the
database.

**Privileged code lives where the client cannot reach it.** A `SECURITY DEFINER`
function runs with the privileges of its owner, which on Supabase means
`postgres` with `BYPASSRLS`. Put one in an exposed schema and any signed-in user
can call it as the superuser. All of them live in a `private` schema that the
Data API cannot see; clients call thin `SECURITY INVOKER` wrappers in `api`.

**Arabic is not a translation layer.** `dir` is derived from the locale, spacing
uses logical properties, and the layout mirrors. Numbers stay Latin even on
Arabic pages, because a pharmacist reads an expiry date off a carton and types it
into a search box.

**Offline is the normal case for a driver.** Not a feature to add later.

## Architecture

```
Browser ──► Next.js 16 (Vercel) ──► Supabase
              React 19, RTL             ├─ Postgres 17  ← the whole domain model
              Server Components         ├─ Auth        ← credentials, tokens
                                          ├─ RLS         ← authorization
              (TypeScript)               ├─ Storage     ← POD photos, signatures
                                          └─ pg_cron     ← alerts, reconciliation
```

There is **no custom API server**. Supabase provides the REST surface, and the
business logic is Postgres functions — which is the right tool here, because the
logic is fundamentally about maintaining invariants across rows (a stock balance
that must equal the sum of its ledger, a FEFO allocation that must skip
quarantined lots). Enforcing those invariants inside the same transaction that
writes the rows is the entire point.

### Repository layout

```
pharmaflow/
├── apps/web/                 Next.js app (admin, pharmacy, distributor)
│   └── src/
│       ├── app/[locale]/     one route group per locale, three per role
│       ├── i18n/             routing, messages (en/ar)
│       ├── lib/              supabase clients, session, types, formatters
│       └── middleware.ts     session refresh + locale negotiation
├── supabase/
│   ├── migrations/           the schema, in order. Source of truth.
│   ├── tests/                pgTAP suites + the no-Docker harness
│   └── seed.sql              local demo data
├── scripts/verify-db.sh      migrations + suites, no Docker required
├── docs/                     architecture, ADRs, runbook
└── Makefile                  every task
```

## Getting started

Requires Node 22, pnpm, and the Supabase CLI. Docker is optional.

```bash
make install          # dependencies
make env              # .env.local from the template, mode 600
make doctor           # what is and is not available
make db               # local Supabase stack (needs Docker)
make dev              # http://localhost:3000
```

### Without Docker

`make verify` runs every check, including the database ones, against a plain
PostgreSQL. Migrations and tests are identical in both paths — only the harness
differs.

```bash
make verify           # lint + typecheck + unit tests + secret scan + migrations + suites + build
```

## Deploying

The app is a pnpm monorepo with the Next.js app in `apps/web`. On Vercel:

| setting | value | why |
|---|---|---|
| Root Directory | `apps/web` | the app is not at the repository root |
| Framework | Next.js | auto-detected, and pinned in `apps/web/vercel.json` |
| Node.js | 22.x | |
| Install / Build | pinned in `vercel.json` | dependencies live in the root workspace |
| Region | `fra1` | matches the Supabase project's region |

Environment variables, and nothing else:

```
NEXT_PUBLIC_SUPABASE_URL              the project URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  the publishable key
```

`SUPABASE_SECRET_KEY` is deliberately **not** among them. It is the
`service_role` key, it bypasses RLS, and it is only read inside
`createSupabaseAdminClient`, which nothing imports. A secret that disables tenant
isolation has no business on a public web host.

The app reaches the `api` schema with `Accept-Profile`/`Content-Profile` headers
rather than supabase-js's `.schema('api')`, because schema-qualified paths are not
served on this project. `apps/web/src/lib/supabase/api-schema.ts` has the
evidence, including the two probes that keep `private` unreachable.

## Verifying it works

```bash
make check      # fast: lint, types, unit tests, secret scan, assertion portability
make test-db    # migrations applied, 160 pgTAP assertions
make verify     # everything CI runs
```

**160 pgTAP assertions** and **18 table-level smoke checks** at the last green run.

The two database suites deliberately cover different ground, and both are needed:

| | What it can prove | What it cannot |
|---|---|---|
| `scripts/ledger-smoke.sh` | The `AFTER INSERT` trigger maintains the balance with **no session and no function involved**; a refused movement records nothing | Anything about roles |
| `supabase/tests/*.test.sql` | That a `DISTRIBUTOR` is refused; that cross-tenant ids are *invisible* rather than merely forbidden | That the trigger works independently of the function |

The security assertions that matter most:

- an anonymous request can read nothing
- a user cannot see another tenant's rows, facilities, products or batches
- a user cannot escalate their own role, and a failed attempt leaves both the role
  and the tenant unchanged
- a `DISTRIBUTOR` can read the catalogue but cannot receive stock or release a batch
- a user can update their own profile, and only their own
- every public table has RLS; `anon` holds no write grant anywhere
- `authenticated` can INSERT only into an allow-list of catalogue tables — and a
  **new table fails the build** until someone adds it deliberately
- no client can write the ledger, the balance, the audit log or the tenant
- no `SECURITY DEFINER` function sits in `public`, and the ones in `api` are
  allow-listed
- the ledger rejects `UPDATE` and `DELETE` for every role including the owner
- a balance is exactly the sum of its ledger
- a recall **moves** the stock into quarantine rather than only changing a label
- reconciliation detects a deliberately corrupted balance without duplicating alerts

There is a CI job that deliberately breaks a policy to confirm the suites can
fail. A security test that cannot fail is worse than none, because it is reported
as coverage. It runs on pull requests as well as pushes.

### One thing that is easy to get wrong

The local harness prefers real pgTAP and falls back to a shim. They differ in ways
that fail *silently*: pgTAP has functions the shim does not, and pgTAP's
`results_eq` compares by type where the shim casts to text. A suite can be green
locally and red in CI on nothing but which engine ran it.

`scripts/check-assertions.py` catches that statically, on every machine: every
assertion must be a real pgTAP function, every comparison must have an explicit
cast on at least one side, and the shim must offer nothing pgTAP lacks. It is wired
into `make check` and into CI ahead of the suites, so a portability problem is
reported as itself rather than as a mysterious schema failure.

## Demo accounts

Created by `supabase/seed.sql`, never by a migration, so they cannot reach a
hosted project. Password for all three: `PharmaFlow#2026`

| Email | Role | Lands on |
|---|---|---|
| `admin@demo.local` | `TENANT_ADMIN` | Control tower |
| `pharmacy@demo.local` | `PHARMACY_MANAGER` | Pharmacy portal |
| `driver@demo.local` | `DISTRIBUTOR` | Driver app |

## Roadmap

Each milestone ends in something a real user could be put in front of.

| | Scope | Status |
|---|---|---|
| **M0** | Repository, toolchain, CI, i18n/RTL foundation | done |
| **M1** | Tenancy, roles, RLS, invite-only auth, audit log | done |
| **M2** | Products, batches, locations, stock ledger, reconciliation | schema + tests done, UI complete: catalogue, batches, locations, stocktake |
| **M3** | Requisitions, approval, FEFO allocation | done |
| **M4** | Trips, driver PWA offline, e-signature POD, live map | done |
| **M5** | Alerts, dashboards, analytics | alerts, dashboards and analytics done; `reorder_policies` and `stock_daily_snapshots` not built |
| **M6** | Go-live gate (see below) | planned |

Deliberately deferred: purchase orders and GRN, invoicing and ETA e-invoicing,
cold-chain sensors, forecasting, React Native.

### Before real use

M6 is not a formality. Two things must change before a distributor's stock or
revenue flows through this:

- **Supabase Pro ($25/mo).** The free tier pauses projects after 7 days of low
  activity, and — more seriously — provides **no downloadable database backup**.
  A system of record for batch numbers and expiry dates, with no backup you can
  export or restore, is not recoverable. This is the one I would not defer.
- **Vercel Pro ($20/mo).** Vercel's Hobby plan is restricted to non-commercial
  personal use by its terms. Hosting a distributor's live business on it is a
  breach, not a free tier.

A restore drill is also part of M6: a backup nobody has restored from is not a
backup.

## Documentation

- [docs/architecture.md](docs/architecture.md) — system design in detail
- [docs/data-model.md](docs/data-model.md) — tables, columns, invariants
- [docs/security.md](docs/security.md) — threat model and controls
- [docs/supabase-dev.md](docs/supabase-dev.md) — local development, both paths
- [docs/runbook.md](docs/runbook.md) — operating it, and what to do when it breaks
- [docs/adr/](docs/adr/) — decisions and why

## License

AGPL-3.0-only.

The product is inspired by Open mSupply and ERPNext, both of which are
copyleft-licensed; nothing was copied from either. The reason for AGPL rather
than a permissive license is that this software moves medicine and records an
audit trail. Anyone running a modified version as a service owes its users the
source of that version. Health-sector buyers read that as a commitment; a
permissive license would read as an absence of one.

Product name and branding are PharmaFlow's own. No mSupply or ERPNext names or
assets appear anywhere in this repository.
