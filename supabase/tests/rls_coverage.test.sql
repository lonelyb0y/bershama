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

select plan(7);

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
-- UPDATE/DELETE are intentionally not asserted here. Those are governed by RLS
-- policies per table (e.g. tenants has no UPDATE policy at all, while
-- invitations has one restricted to TENANT_ADMIN). A blanket "no update grant"
-- rule would forbid a legitimate, policy-guarded operation.
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
  $$,
  'authenticated cannot INSERT directly into any public table'
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
