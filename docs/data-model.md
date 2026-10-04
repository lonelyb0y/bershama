# Data model

M1 state: identity, tenancy, roles, audit. Domain tables arrive with M2 — the
catalogue, batches, the stock ledger, requisitions and delivery.

Defined in `supabase/migrations/`, which is the source of truth. This document
explains the reasoning; the SQL explains the implementation.

## Conventions

Applied to every table, so a reader does not have to check each one.

**`uuid` primary keys**, defaulting to `gen_random_uuid()`. A sequential integer
leaks row counts and volume to anyone who sees an id, and batch numbers and
requisition numbers are the human-facing identifiers instead.

**`timestamptz` in UTC**, rendered in the tenant's timezone by the client. Never
`timestamp` without a zone: a naive timestamp in a database is a bug waiting for
a daylight-saving boundary.

**`bigint` for money**, counting minor units. See
[ADR 0004](adr/0004-money-as-integer-minor-units.md).

**`tenant_id` on every table**, with RLS. No exceptions. Retrofitting tenancy is
the most expensive mistake available in a multi-tenant system, so it is not
optional and not per-table.

**Constraints in the database, not only in the application.** A `check` on
`slug` or a `unique` on `(tenant, lot_number)` protects the invariant regardless
of which client wrote the row. Application validation is for error messages;
database constraints are for correctness.

**`created_at` and `updated_at`** on mutable tables, with a trigger for the
latter. `audit_logs` deliberately has no `updated_at`: it is not mutable.

## Enums

Postgres enums, in `private`, because the client must not be able to invent a
value.

### `private.app_role`

| Value | Surface | Intent |
|---|---|---|
| `TENANT_ADMIN` | admin | full control within the tenant |
| `WAREHOUSE_MANAGER` | admin | approve, allocate, dispatch, adjust stock |
| `DISPATCHER` | admin | build routes, assign drivers, monitor |
| `PHARMACY_MANAGER` | pharmacy | requisitions for their own facility |
| `DISTRIBUTOR` | distributor | execute stops, capture proof of delivery |
| `ANALYST` | admin | read dashboards and reports, nothing else |

`ANALYST` exists because "can see everything" and "can change anything" are
different permissions, and conflating them means every report user can also
adjust stock.

### `private.batch_status`

`QUARANTINED`, `RELEASED`, `RECALLED`, `EXPIRED`, `DEPLETED`.

A batch is a state machine, not a boolean. `is_active = false` cannot distinguish
"we are holding it pending inspection" from "a regulator recalled it", and those
demand different actions. Batches are never deleted — see
[ADR 0003](adr/0003-append-only-stock-ledger.md).

### `private.facility_kind`, `private.location_kind`

`WAREHOUSE`, `PHARMACY`, `HOSPITAL`, `CLINIC`.

`RECEIVING`, `QUARANTINE`, `AMBIENT`, `COLD`, `FREEZER`, `IN_TRANSIT`, `BIN`,
`DISPENSE`.

`QUARANTINE` and `IN_TRANSIT` are the two that carry weight. Quarantine is
received-but-not-released, which under GDP is a distinct state with a release
signature. `IN_TRANSIT` is a virtual location, so stock in a van is still
counted and still owned by the distributor.

## Tables

### `public.tenants`

A distributor company. One row today; a second distributor is a row and no schema
change.

| Column | Notes |
|---|---|
| `slug` | unique, `^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$` |
| `name_en`, `name_ar` | `name_en` required; both for an Egyptian operator |
| `country_code` | `char(2)`, defaults `EG` |
| `currency_code` | `char(3)`, defaults `EGP` |
| `vat_rate` | `numeric(5,2)` 0–100. A setting, never a constant: rates change |
| `timezone` | defaults `Africa/Cairo` |
| `locale_default` | `en` or `ar` |
| `min_shelf_life_pct` | FEFO floor, defaults 25 |

`min_shelf_life_pct` is a quiet column with a large effect. It says: do not
allocate stock with less than a quarter of its total shelf life remaining. Without
it, FEFO will cheerfully hand a pharmacy a box with three weeks left, which
becomes the distributor's problem the moment it does not get used. A
tenant-level setting because the right answer depends on the business, not on
pharmacology.

No `updated_at` trigger beyond the standard one; settings changes go through
`api.update_tenant_settings()` so they are audited.

### `public.profiles`

Application-side user data. Credentials live in `auth.users` and never here.

| Column | Notes |
|---|---|
| `id` | `references auth.users(id) on delete cascade` |
| `tenant_id` | `references public.tenants(id) on delete cascade` |
| `role` | `private.app_role not null` |
| `full_name`, `full_name_ar` | at least one is required in practice |
| `locale` | per-user override of the tenant default |
| `is_active` | checked in every RLS helper, not only at sign-in |
| `last_seen_at` | liveness for the admin view |

**Roles live here, not in `auth.users.raw_user_meta_data`.** That field is
user-editable through `supabase.auth.update()`. A role read from it would be a
self-service privilege escalation. This is asserted by a test.

The `profiles_tenant_id_fkey` and `profiles_enforce_tenant` trigger together
guarantee a user belongs to exactly one tenant: the foreign key prevents an
unknown tenant, and the trigger rejects a row whose `tenant_id` differs from the
caller's.

### Forward declaration note

`profiles` is *created* in `0001_foundation.sql` with only the five columns the
RLS helpers reference, and *extended* in `0002_identity.sql`. This is not tidiness
— Postgres validates a function body at `CREATE` time, so
`private.current_tenant_id()` cannot be created before the table exists. The
alternative was moving the helpers after the table, which would leave 0001 with
policies that cannot compile.

### `public.invitations`

Invite-only onboarding. `enable_signup = false` means there is no public
registration path at all.

| Column | Notes |
|---|---|
| `token_hash` | hashed, never the token itself |
| `expires_at` | 7 days |
| `status` | `pending`, `accepted`, `revoked`, `expired` |
| `role` | the role the invitee will hold |

No client-side `INSERT` grant. Creating an invitation goes through
`api.invite_user()`, which also sends the email and writes the audit entry, so
there is exactly one path and it is auditable.

`users` and `invitations` reference each other only loosely — an accepted
invitation is not a foreign key to a user, because acceptance and row creation
happen in two transactions by design.

### `public.audit_logs`

Append-only. Required by WHO GDP and the first thing an auditor asks for.

| Column | Notes |
|---|---|
| `id` | `bigint generated always as identity` — never reused |
| `actor_user_id` | `on delete set null`, so the trail survives offboarding |
| `actor_label`, `actor_role` | denormalised, so history does not change meaning |
| `before`, `after` | `jsonb` |
| `request_id` | ties related rows to one request |

`deny_audit_mutation()` raises on `UPDATE` and `DELETE` **for every role
including the table owner**. An auditor with database access must not be able to
rewrite history either.

No client `INSERT`. Entries come from `private.write_audit()` inside the same
transaction as the change, so a change and its audit row commit or roll back
together. A trail that can drift from reality is worse than no trail.

## RLS helper functions

All `STABLE`, all `SECURITY DEFINER`, all with `set search_path = ''`.

`SECURITY DEFINER` is what breaks the recursion: `profiles`' own policy calls
`private.current_tenant_id()`, which reads `profiles`. Without `DEFINER` the read
re-enters the policy and Postgres raises `42P17 infinite recursion detected`.

`STABLE` lets the planner hoist a `(select private.current_tenant_id())` into an
`initPlan` and evaluate it once per statement rather than once per row. The
`(select …)` call form in the policies is what enables that, and it matters: a
policy evaluated per row against a million-row table is a sequential scan.

| Function | Returns |
|---|---|
| `private.current_tenant_id()` | caller's tenant, or NULL |
| `private.current_role()` | caller's role from `profiles` |
| `private.has_role(variadic)` | role is any of the given values |
| `private.can_write_inventory()` | role may move stock |
| `private.write_audit(...)` | appends an audit row as the caller |

Every one returns NULL rather than erroring when unauthenticated, so a policy
comparison is simply false and an anonymous request reads nothing.

## The `api` surface

`SECURITY INVOKER` wrappers. Small, stable, auditable.

| Function | Purpose |
|---|---|
| `api.whoami()` | identity, tenant, role, currency in one round trip |
| `api.update_tenant_settings(jsonb)` | audited settings change |
| `api.update_my_profile(...)` | audited self-service edit |
| `api.touch()` | `last_seen_at`, on a hot path, must never fail a request |

`api.whoami()` is the only one called on every page render. It returns zero rows
for a user with no profile or an inactive profile, both of which must read as "no
session" rather than as a broken tenant.

## Grants

Every migration, in this order:

```sql
revoke all on table … from anon, authenticated;   -- remove Supabase defaults
grant select on table … to authenticated;          -- add back only what is needed
```

The order is the point. Supabase grants `select, insert, update, delete` on every
new `public` table, and **adding a policy does not remove those grants**. A table
with RLS enabled and full grants is fully writable. Revoking first is the only
thing that closes it.

Current state, asserted by `rls_coverage.test.sql`:

- `anon` holds no write grant on any public table.
- `authenticated` holds no `INSERT` on any public table. Every write goes through
  an audited `api.*` function.
- `UPDATE`/`DELETE` exist only where a policy confines them, and are asserted
  per table rather than banned globally.

## Indexes

Every index serves a stated query. An index on a column no policy filters is
write amplification for nothing.

| Index | Serves |
|---|---|
| `profiles (tenant_id)` | the admin "list my users" query, and the RLS tenant filter |
| `audit_logs (tenant_id, occurred_at desc)` | the audit list, newest first |
| `audit_logs (tenant_id, entity_type, entity_id)` | "show me everything about this batch" |
| `audit_logs (tenant_id, actor_user_id)` | "what did this person do" |

The composite-key warning is real: Postgres cannot use a multi-column index to
filter on a non-leading column, so a `primary key (tenant_id, id)` indexes
`tenant_id` and nothing else. Policy filter columns get their own index.

## M2: the inventory core

Delivered. Every table below has RLS enabled and a `tenant_id`, and every write
path is an audited `api.*` function.

| Table | Notes |
|---|---|
| `facilities` | warehouses, pharmacies, hospitals, clinics. Coordinates are `numeric(9,6)`, not float, because route maths accumulates error |
| `storage_locations` | per facility: ambient, cold, frozen, quarantine, in-transit, dispense. Codes unique per **facility**, not per tenant |
| `products` | **both** `name_en` and `name_ar` required. Real ATC codes are 7 characters; a 5-character pattern rejects all of them |
| `batches` | lot, mfg/expiry, unit cost, status. Never hard-deleted. Unique per (tenant, **product**, lot) |
| `stock_ledger` | append-only, signed `qty_delta`, sign bound to `txn_type`. `bigint identity` |
| `stock_balances` | materialisation maintained by an `AFTER INSERT` trigger. `check (qty_on_hand >= 0)` |
| `alert_events` | operational and invariant alerts. Partial unique index on (tenant, type, entity) where `OPEN`, so a nightly scan cannot duplicate |

### Enums added in M2

`private.movement_type` (12 values, with a legal sign for each),
`private.product_form`, `private.stock_unit`, `private.strength_unit`,
`private.alert_type`, `private.alert_severity`, `private.alert_status`.

## Still to come

| Table | Milestone |
|---|---|
| `requisitions`, `requisition_lines`, `allocations` | M3 — FEFO allocation |
| `trips`, `stops`, `tracking_pings`, `proof_of_delivery`, `delivery_events` | M4 — delivery |
| `products.manufacturer` / `drug_class` / `source` | M5 — added by migration 20260101000068 for the Egyptian |
| `reorder_policies` | M5 — not built; the alert scan and the analytics page both use days of cover from the ledger and `tenants.settings` instead |
| `stock_daily_snapshots` | M5 — built by migration 20260101000072; `api.snapshot_stock()` writes the day, idempotently |
| `cold_chain_readings` | M5 — not built |
| `batch_serials` | v2 — `products.is_serialised` is already declared and inert |

A table with no reader and no test is speculative, so `reorder_policies` and
`stock_daily_snapshots` are deferred to the milestone that consumes them rather
than built now and forgotten.
