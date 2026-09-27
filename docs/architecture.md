# Architecture

How PharmaFlow is put together, and why. For the schema itself see
[data-model.md](data-model.md); for the security argument see
[security.md](security.md).

## The shape of the system

```
┌──────────────────────────────────────────────────────────────┐
│ Driver's phone          Admin laptop         Pharmacy        │
│ (PWA, offline)           (desktop)            (PWA)          │
└───────────┬───────────────────┬──────────────────┬───────────┘
            │ publishable key    │                  │
            └────────────────────┴──────────────────┘
                             │
                    ┌────────▼─────────┐
                    │  Next.js 16      │  Vercel
                    │  Server          │  React Server Components,
                    │  Components      │  route protection
                    └────────┬─────────┘
                             │ publishable key (anon → authenticated)
                    ┌────────▼─────────┐
                    │  Supabase        │
                    │                 │
                    │  Auth           │  credentials, JWT rotation
                    │  PostgREST      │  generated REST surface
                    │  RLS            │  ← authorization lives here
                    │  Postgres 17    │  ← the domain model
                    │  Storage        │  POD photos, signatures
                    │  Realtime       │  live driver positions
                    │  pg_cron        │  alerts, reconciliation
                    └─────────────────┘
```

There is no application server. Not as an omission — as a decision. See
[ADR 0001](adr/0001-supabase-native-backend.md).

## Why the business logic is in Postgres

The alternative was a Go or Node service with an ORM. It was rejected because
the hard part of this product is not moving bytes between a client and a
database. It is keeping four invariants true across many rows at once:

1. `stock_balances` must equal the sum of `stock_ledger` for its key.
2. A FEFO allocation must never select a quarantined, recalled, or short-dated
   batch, and must not oversell.
3. A dispatch must move stock out of the source and a delivery must move it in,
   and the two must balance even if the truck is robbed in between.
4. An audit entry must be written in the same transaction as the change it
   describes, or not at all.

Each of those is a multi-row invariant. Expressing them in a single transaction
against the same engine that stores the rows means they cannot be violated by a
crash, a timeout, a second writer, or a bug in an application layer. A
compensating-transaction design across a service boundary is possible and much
harder to prove correct.

So the domain logic is `SECURITY DEFINER` functions in a `private` schema, and
the client calls thin wrappers in `api`. The tests are pgTAP, run against real
Postgres, not mocks: a mock cannot tell you that a policy is wrong.

## Schema layout

Four schemas, and the split is a security boundary rather than tidiness.

| Schema | Contents | Exposed to the Data API |
|---|---|---|
| `auth` | Supabase-managed credentials | yes (managed) |
| `public` | Tables, views, RLS policies | yes |
| `api` | Client wrappers: reads `INVOKER`, **writes `DEFINER`** | yes, deliberately |
| `private` | `SECURITY DEFINER` implementations, helpers | **no** |

A `SECURITY DEFINER` function executes with the privileges of its owner, which on
Supabase means `postgres` with `BYPASSRLS`, and Supabase exposes every schema in the
project's API settings. A privileged function in an exposed schema is therefore a
function any signed-in user can call as the superuser.

The read/write split inside `api` is not a preference. `private` has no `USAGE`
grant to client roles, so an `INVOKER` wrapper cannot reach `private.*` at all — a
write wrapper has to be `DEFINER` to do its job, which makes the wrapper itself the
security boundary. Each one checks the caller's role and scopes to
`private.current_tenant_id()`. Full reasoning and costs in
[ADR 0002](adr/0002-rls-and-privileged-functions.md).

`rls_coverage.test.sql` enforces the shape: no `SECURITY DEFINER` function in
`public`, and the ones in `api` must be on a fail-closed allow-list.

Views get the same treatment: Postgres creates them `security definer` by default,
so a view over a protected table hands out every row the policies withheld. Every
view here is `with (security_invoker = true)`.

A view is also a privilege-bearing object. Revoking the default `PUBLIC` grant
without adding `authenticated` back does not hide it, it breaks it — every `SELECT`
fails with `permission denied for view`, which looks nothing like a permissions
problem. So the read views and their base tables carry explicit `SELECT` grants,
with RLS as the gate for reads and no write grant at all on the ledger or the
balance.

## Authorization

Authorization is the database's job. Every table in `public` carries
`tenant_id`, RLS is enabled, and the scoping expression is
`tenant_id = private.current_tenant_id()`.

The current tenant comes from `profiles`, keyed to `auth.uid()`. Not from the
URL, not from a header, not from a claim. A client that asks for another
company's data by sending a different id gets nothing, because the id it sent
never reaches the query.

Role checks go through `private.has_role(...)`, which reads the same
`profiles` table. Roles are deliberately *not* read from
`auth.jwt() -> 'user_metadata'`, because `raw_user_meta_data` is user-editable
via `supabase.auth.update()`. A role read from there would be a self-service
privilege escalation.

### Grants and policies are different gates

Both are needed, and the distinction explains most of the SQL:

- **Grants** decide whether an operation is possible at all. Postgres raises
  `42501` when a grant is missing.
- **Policies** decide which rows it applies to. A `using` clause that filters the
  row out raises nothing and simply matches zero rows.

Supabase gives every new `public` table full `insert/update/delete` to `anon` and
`authenticated`. Adding a policy does not remove those grants, so each migration
`revoke`s first and then grants back only what is needed.

Clients hold **no** `INSERT` on any public table. Every write goes through an
`api.*` function that validates it and writes the audit entry in the same
transaction. `stock_ledger`, `stock_balances` and `audit_logs` are not
client-writable at all.

## Errors carry codes, not sentences

Movement functions raise a stable error **code** as the message, with the parameters
in `detail` as JSON:

```sql
raise exception using errcode = 'P0001',
                      message  = 'insufficient_stock',
                      detail   = json_build_object('available', 12, 'requested', 40)::text;
```

The client maps the code to a localised string. This is not stylistic: the UI is
bilingual, and an English sentence inside a `raise` cannot be translated. Recovering
a number by parsing prose is how a translated UI ends up showing the wrong number.

The `message` stays English for the logs, because logs are who reads them. Tests
assert the **code** and never the prose.

The codes in use: `insufficient_stock`, `batch_not_released`, `batch_expired`,
`batch_product_mismatch`, `batch_not_found`, `location_not_found`,
`duplicate_lot_number`, `invalid_expiry_date`, `shelf_life_implausible`,
`reason_code_required`, `recall_reason_required`, `quantity_must_be_positive`,
`same_location_transfer`, `cannot_release_expired_batch`,
`illegal_batch_transition`, `quarantine_reason_required`,
`no_quarantine_location`, `insufficient_role`, `zero_quantity_movement`.

## Roles

| Role | Surface | Can |
|---|---|---|
| `TENANT_ADMIN` | admin | everything within the tenant |
| `WAREHOUSE_MANAGER` | admin | approve, allocate, dispatch, adjust stock |
| `DISPATCHER` | admin | build routes, assign drivers, monitor trips |
| `PHARMACY_MANAGER` | pharmacy | create and submit requisitions for their facility |
| `DISTRIBUTOR` | distributor | execute stops, capture proof of delivery |
| `ANALYST` | admin | read dashboards and reports, nothing else |

The three surfaces are separated by role rather than by hiding controls. A
driver's phone shows a stop list and nothing else; sharing one screen with
disabled tabs means every shipped control is a control the driver could reach.

A signed-in user is routed to the surface their role belongs on, and the
destination is read from the database, not from anything the browser sent. The
route guard re-checks it server-side, because a client-side check is a
convenience and not a boundary.

## Request lifecycle

1. **Middleware** refreshes the Supabase session. JWTs last an hour; without
   this a shift-length session starts failing every query. It uses `getUser()`,
   which validates against the auth server, not `getSession()`, which only reads
   the cookie's own claim.
2. **Middleware** resolves the locale via next-intl, so `/ar/...` and `/en/...`
   both work and `<html dir>` is correct before first paint.
3. **Layout guard** calls `api.whoami()` — identity, tenant and role in one
   round trip — and renders `notFound()` for a role that does not belong on the
   surface. A 404 rather than a redirect, so a user guessing `/admin` is not told
   it exists and a real authorisation bug stays visible during testing.
4. **Page** reads data through the RLS-scoped client. Every query returns only
   the caller's tenant.

## Internationalisation

Two locales, `en` and `ar`, always URL-prefixed so a deep link is unambiguous.

`dir` is a property of the locale, not of a component, and spacing uses logical
properties (`padding-inline`) so one stylesheet serves both directions. Arabic
does not reverse numbers: expiry dates, quantities, prices, GTINs and lot numbers
render in Latin digits, because they are transcribed from packaging. Hijri dates
are never stored — records stay Gregorian, which is what a regulator wants — and
a Hijri display layer can be added later without a migration.

Arabic font rendering is not negotiable: the system fallback joins Arabic letters
incorrectly in several browsers, so IBM Plex Sans Arabic is loaded through
`next/font`, which also means no request to Google at runtime.

## Offline

A driver in Cairo loses signal routinely. The PWA is a first-class client:

- The service worker (Serwist) precaches the shell and the catalogue.
- TanStack Query persists query results to IndexedDB, so the catalogue and the
  stop list render with no network.
- **Mutations queue in a Dexie outbox** and replay on reconnect. Each carries a
  client-generated idempotency key; the server deduplicates on it. A blind retry
  would double-deliver.

Idempotency is the part that has to be right. Offline replay means the same
request arrives more than once by design, and a delivery confirmed twice is a
stock discrepancy that surfaces days later as an unexplained variance.

## Background work

`pg_cron` runs in the database, which means the jobs are in the same transaction
model as everything else and cannot drift out of sync with the data.

| Job | Cadence | Purpose |
|---|---|---|
| `compute_expiry_alerts` | nightly | 90/60/30-day expiry buckets |
| `compute_low_stock_alerts` | nightly | below the reorder point |
| `reconcile_stock_balances` | nightly | re-derive balances from the ledger, alert on drift |
| `rollup_daily_snapshots` | nightly | pre-aggregate so dashboards never scan the ledger |
| keep-alive | hourly | reduce free-tier inactivity-pause risk (remove after Pro) |

Reconciliation is the important one. `stock_balances` is a materialization for
speed; the ledger is the truth. A nightly job rebuilds the balances from the
ledger and raises a `CRITICAL` alert on any difference. That is the difference
between a system that *should* be right and one that can prove it is.

## Money

`bigint` minor units, everywhere. `1 EGP = 100` piastres.

Never `numeric` for a price that has to be totalled, and never `float`. Postgres
`numeric` is exact but awkward to sum in a UI; a float accumulates error. The
conversion to major units happens once, in
[`format.ts`](../apps/web/src/lib/format.ts), and the result is never stored.

The formatters are unit-tested for this specifically: a sweep asserting that
every value from 0 to 100,000 piastres round-trips, and a case at
12,345,678,901 piastres — the magnitude where a float starts dropping digits.

## Storage

Private buckets with signed URLs. Paths are
`pod-media/{tenant_id}/{stop_id}/{file}`, so `storage.objects` RLS works by path
prefix and a signed URL cannot be minted for another tenant's delivery.

Proof-of-delivery signatures are stored inline as base64 rather than as files.
They are small, immutable once written, and are evidence: co-locating them with
the delivery row means they cannot be orphaned.

## Deployment

| | |
|---|---|
| Web | Vercel |
| Database, auth, storage, realtime, cron | Supabase |
| Region | Frankfurt (`eu-central-1`) — see below |
| Migrations | `supabase db push` from CI, or `make db-push` locally |

**On the region.** Egypt has no Supabase region. The nearest options are Mumbai
and Singapore; Frankfurt generally has lower latency to Egypt and sits under a
stronger data-protection regime. This is a latency and jurisdiction judgement,
not a compliance answer: region selection is a data-*location* control, not
proof of regulatory compliance, and a customer with an in-country residency
requirement would need a different arrangement entirely.

## Testing

| Layer | Tool | What it proves |
|---|---|---|
| SQL | pgTAP | policies, functions, invariants, against real Postgres |
| Pure logic | Vitest | date arithmetic, money, expiry banding |
| End-to-end | Playwright | the flows a real user performs |
| Build | `tsc` + `next build` | types agree across the language boundary |

The database suite is the one that carries the weight, because it tests the only
layer where the security boundary actually lives. It runs against a real
Postgres, never a mock, and `make test-db` runs the identical files without
Docker so the suite cannot silently depend on one environment.
