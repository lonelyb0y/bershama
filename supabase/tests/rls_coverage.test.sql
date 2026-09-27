-- ============================================================================
-- rls_coverage.test.sql
--
-- Schema-wide CI gate. A table in an exposed schema without RLS is readable and
-- writable by anyone holding the default grants, so adding one by accident is a
-- production data breach. This test fails the build if that happens.
--
-- The same reasoning applies to SECURITY DEFINER functions: one sitting in an
-- exposed schema is callable over the Data API as postgres (which has
-- BYPASSRLS), so api.whoami() as a trivial identity function would be a
-- critical vulnerability. This test enforces the private/api split.
-- ============================================================================

begin;

select plan(9);

-- ── every public table has RLS enabled ──────────────────────────────────────

select is_empty(
  $$
  select c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')          -- ordinary and partitioned tables
    and not c.relrowsecurity
  $$,
  'every table in the public schema has row level security enabled'
);

-- ── no public table allows direct INSERT from a client role ────────────────
-- Grants and policies are different gates and both are needed:
--
--   grants    decide whether an operation is possible at all
--   policies  decide which rows it applies to
--
-- Adding a policy does NOT remove a grant. Supabase gives new `public` tables
-- full insert/update/delete to anon and authenticated, so the revoke-then-grant
-- step in each migration is what actually closes the door. This asserts the
-- dangerous one specifically: no client may INSERT a row directly. Every
-- insert goes through an api.* function that validates and audits it.
--
-- ── no client INSERT outside the catalogue allow-list ───────────────────────
-- Grants and policies are different gates and both are needed:
--
--   grants    decide whether an operation is possible at all
--   policies  decide which rows it applies to
--
-- Adding a policy does NOT remove a grant. Supabase gives new `public` tables
-- full insert/update/delete to anon and authenticated, so the revoke-then-grant
-- step in each migration is what actually closes the door.
--
-- The allow-list below is deliberate, and the direction of the rule matters:
-- a table must be ADDED to this list to become client-writable. A new table in
-- `public` therefore fails this test until someone deliberately decides it may
-- be written directly, which is fail-closed.
--
--   facilities, storage_locations, products
--       Ordinary catalogue CRUD. The cross-row invariants do not exist here, and
--       an AFTER trigger writes the audit entry, so a direct write is safe and
--       keeps the create/edit forms simple.
--
-- Everything NOT on the list is written only through an api.* function:
--   tenants, profiles, invitations   identity, audited through functions
--   stock_ledger, stock_balances     the ledger and its materialisation
--   alert_events                     written by private.* jobs
--   audit_logs                       written by private.write_audit()
--
-- anon should hold nothing at all on tenant data.

select is_empty(
  $$
  select c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and has_table_privilege('anon', c.oid, 'insert,update,delete')
  $$,
  'anon holds no write grant on any public table'
);

select is_empty(
  $$
  select c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and has_table_privilege('authenticated', c.oid, 'insert')
    and c.relname <> all (array[
      'facilities', 'storage_locations', 'products'
    ])
  $$,
  'authenticated can INSERT only into the allow-listed catalogue tables'
);

-- The critical tables that exist in M1 are also asserted by name, so the
-- allow-list above cannot quietly grow to cover them. "Not on the list" and
-- "specifically forbidden" are different claims, and only the second survives
-- someone adding a table to the list in a hurry.
--
-- stock_ledger, stock_balances and alert_events arrive in M2 and are asserted in
-- inventory_grants.test.sql, once they exist. Referencing them here would fail
-- this suite on a clean M1 database.
select ok(
  not has_table_privilege('authenticated', 'public.audit_logs', 'insert,update,delete')
    and not has_table_privilege('anon', 'public.audit_logs', 'insert,update,delete'),
  'no client role can write the audit log'
);

select ok(
  not has_table_privilege('authenticated', 'public.tenants', 'insert,update,delete'),
  'no client role can write the tenant record'
);

-- ── a direct client insert into the audit log is impossible ────────────────
-- audit_logs is written exclusively by private.write_audit() from inside the
-- transaction that made the change. If a client could append to it, the trail
-- could be forged, which defeats the purpose of having one.
--
-- Asserted as a privilege check rather than an attempted insert: the suite is
-- running as the owner here, so only the GRANT can be observed, and that is
-- precisely what is being tested. The rls_policies suite covers the row-level
-- behaviour under a real authenticated role.

select ok(
  not has_table_privilege('authenticated', 'public.audit_logs', 'insert')
    and not has_table_privilege('anon', 'public.audit_logs', 'insert'),
  'no client role can INSERT into audit_logs; entries come only from private.write_audit()'
);

-- ── schema split is intact ──────────────────────────────────────────────────

select ok(
  not has_schema_privilege('anon', 'private', 'usage')
  and not has_schema_privilege('authenticated', 'private', 'usage'),
  'the private schema is not reachable by client roles'
);

-- ── no SECURITY DEFINER function in an exposed schema ───────────────────────

select is_empty(
  $$
  select p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'api')
    and p.prosecdef
  $$,
  'no SECURITY DEFINER function sits in an exposed schema'
);

-- ── every SECURITY DEFINER function pins its search_path ────────────────────
-- Without `set search_path = ''` a caller can create an unqualified object that
-- shadows a name inside the function and run it as the function owner.

select is_empty(
  $$
  select p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.prosecdef
    and p.proconfig is null
  $$,
  'every private SECURITY DEFINER function pins search_path'
);

select * from finish();
rollback;
