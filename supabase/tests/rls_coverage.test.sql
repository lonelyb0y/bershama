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

select plan(19);

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
        'facilities', 'storage_locations', 'products',
        -- M3. A requisition is raised by writing the table directly, and RLS is
        -- the right mechanism for it: the insert policy restricts the caller to
        -- the distributor-side roles, and the tenant trigger overwrites
        -- tenant_id so the column cannot be chosen at all.
        --
        -- Note the asymmetry, which is deliberate: there is NO delete grant on
        -- requisitions, because an allocated request is the evidence that stock
        -- moved. Lines are scratch work inside a draft, so they are removable --
        -- and the delete policy enforces that their parent is still a DRAFT.
        'requisitions', 'requisition_lines'
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

-- ── privileged functions in exposed schemas are an allow-list ───────────────
-- There must be no SECURITY DEFINER function in `public`, where nothing would
-- catch a misplaced one.
--
-- The `api` schema is different, and deliberately so. A write wrapper there has to
-- be SECURITY DEFINER: `private` carries no USAGE grant to client roles, so an
-- INVOKER wrapper cannot reach the privileged code it needs to call. The wrapper
-- IS the security boundary, and it is only safe because it checks the caller's
-- role and scopes itself to the caller's tenant.
--
-- So the invariant is not "no DEFINER in api" -- it is "only these DEFINER
-- functions in api, and each one authorises itself". The allow-list is
-- fail-closed: adding a SECURITY DEFINER function to `api` fails this test until
-- someone deliberately adds it here, which is the moment to ask whether it really
-- needs to be in an exposed schema at all.
--
-- Read wrappers (api.whoami, api.current_tenant_id, api.search_products,
-- api.get_product, api.get_batch_stock) are INVOKER and so never appear here --
-- they are safe by running as the caller under RLS.

select is_empty(
  $$
  select p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
  $$,
  'no SECURITY DEFINER function sits in the public schema'
);

select is_empty(
  $$
  select p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api'
    and p.prosecdef
    and p.proname <> all (array[
      -- identity and self-service (M1)
      'update_my_profile', 'update_tenant_settings', 'touch',
      -- stock and batch writes (M2); each calls private.require_inventory_write()
      'receive_stock', 'issue_stock', 'adjust_stock', 'write_off_stock',
      'transfer_stock',
      'stock_take',
      'release_batch', 'quarantine_batch', 'recall_batch', 'create_batch',
      -- requisition lifecycle (M3). SECURITY DEFINER is not a preference here:
      -- these call private.current_tenant_id() and private.has_role(), and
      -- `private` is a schema `authenticated` cannot even name. Under security
      -- invoker every one of them returns 42501 "permission denied for schema
      -- private" and the whole workflow is unreachable. The risk that buys is
      -- bounded by `set search_path = ''` plus full schema qualification in every
      -- body, so an unqualified name is what to watch for -- not the volatility.
      --
      -- submit_requisition and reject_requisition constrain themselves as well:
      -- the requester cannot reject their own request, and only the
      -- distributor-side roles may reject at all.
      'submit_requisition', 'reject_requisition',
      'allocate_requisition', 'release_requisition'
    ])
  $$,
  'only the allow-listed wrappers in the api schema are SECURITY DEFINER'
);

  -- ── the api schema must be VISIBLE to PostgREST ────────────────────────────
  --
  -- Everything else in this suite runs as the owner over plain PostgreSQL, where
  -- a schema's reachability is not a question. PostgREST is different: it logs
  -- in as `authenticator` and includes only the schemas it holds USAGE on, and a
  -- schema it cannot see is simply not there. The failure is PGRST125, "Invalid
  -- path specified in request URL", which reads like a bad URL rather than a
  -- missing GRANT.
  --
  -- 0012 exists because of this. The `api` schema had USAGE for `authenticated`
  -- and nobody else, so every stock and batch function was unroutable over HTTP
  -- and the application could not sign in -- invisible to tsc, to every stub,
  -- and to this suite as it then stood.
  select ok(
    has_schema_privilege('authenticator', 'api', 'USAGE'),
    'PostgREST can see the api schema, so its functions are routable'
  );

  select ok(
    has_schema_privilege('service_role', 'api', 'USAGE'),
    'service_role can see the api schema'
  );

  select ok(
    has_schema_privilege('authenticated', 'api', 'USAGE'),
    'authenticated can see the api schema'
  );

  -- The negative half, and the more important one.
  --
  -- The obvious response to "the api schema is not visible" is to grant broadly.
  -- Granting USAGE on `private` to authenticator would expose every function in
  -- it to every request: the whole privileged surface, the balance trigger, the
  -- single writer of the ledger, with no RLS in front of any of it. It is a
  -- one-line mistake and, before this assertion, had no test to catch it.
  select ok(
    not has_schema_privilege('authenticator', 'private', 'USAGE'),
    'PostgREST cannot see the private schema'
  );

  select ok(
    not has_schema_privilege('authenticated', 'private', 'USAGE'),
    'authenticated cannot see the private schema'
  );

  select ok(
    not has_schema_privilege('service_role', 'private', 'USAGE'),
    'service_role cannot see the private schema'
  );

  -- ── `anon` must be unable to execute anything in `api` ─────────────────────
  --
  -- Asserted over the WHOLE schema rather than a fixed list, so a function added
  -- after this suite was written is covered too. The dashboard's "Exposed
  -- functions" list grants EXECUTE to the API roles, and on this project ticking
  -- three functions there granted EXECUTE to anon on all eighteen -- including
  -- api.stock_take, which is SECURITY DEFINER and moves stock.
  --
  -- It was inert only because anon lacks USAGE on the schema, and an invariant
  -- that depends on a checkbox in a dashboard is not an invariant.
  -- Counted in a CTE rather than as an inline subquery, because
  -- scripts/check-assertions.py treats any line beginning `select <fn>(` as a
  -- pgTAP assertion and rejects `count(` as an unknown one. That rule is worth
  -- keeping -- it is what stops a plain query being mistaken for a test -- so
  -- the assertions are shaped to suit it rather than the rule being loosened.
  with api_grants as (
    select
      count(*) filter (where has_function_privilege('anon', p.oid, 'execute'))
        as anon_can_execute,
      count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute'))
        as authenticated_can_execute,
      count(*) as total
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api'
  )
  select is(
    (select anon_can_execute from api_grants),
    0::bigint,
    'anon cannot EXECUTE any function in the api schema'
  );

  select ok(
    not has_schema_privilege('anon', 'api', 'USAGE'),
    'anon cannot even name the api schema'
  );

  -- The positive half, so the test above cannot be satisfied by revoking
  -- everything from everyone.
  with api_grants as (
    select
      count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute'))
        as authenticated_can_execute,
      count(*) as total
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api'
  )
  select is(
    (select authenticated_can_execute from api_grants),
    (select total from api_grants),
    'authenticated can still EXECUTE every function in the api schema'
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
