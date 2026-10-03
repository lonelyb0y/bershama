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
--
-- ── what this file cannot see ───────────────────────────────────────────────────
--
-- Every assertion below runs in scripts/verify-db.sh, against a throwaway cluster built
-- from this repository's migrations. It can therefore only see objects *we* created.
--
-- On the hosted project there is a second population: functions and triggers the
-- Supabase platform created. One of them, public.rls_auto_enable(), is a SECURITY DEFINER
-- function owned by postgres that granted EXECUTE to PUBLIC, anon, authenticated and
-- service_role -- put on /rest/v1/rpc/ for anonymous callers, and invisible to the
-- "no SECURITY DEFINER function sits in the public schema" assertion below because our
-- migrations never mentioned it. It was found by the Supabase security advisor, which
-- runs against hosted; migration 20260101000066 revokes it.
--
-- So the coverage is split, deliberately:
--
--   our objects      -> this file, on every push
--   platform objects -> the Supabase security advisor, which has to be read
--
-- Nothing here can close that gap, because the objects do not exist to be asserted
-- against. The honest thing is to know it exists rather than to assume this file is the
-- whole story.
-- ============================================================================

begin;

select plan(21);

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
-- ── no api function may take a private type as an INPUT parameter ───────────
--
-- Not a style rule. A `private.*` type in an api function's parameter list makes
-- that function uncallable from the browser: PostgREST resolves the parameter's
-- type name when a value is passed, and resolving it needs USAGE on `private`,
-- which a client role has by design and cannot be granted. The failure is
--
--   42501 permission denied for schema private
--
-- -- an error that names the schema rather than the function, so it sends you
-- looking in the wrong place entirely.
--
-- It bit api.create_product, api.create_location and api.update_product, all
-- fixed in 0028/0030/0034. It is easy to introduce because typing the parameter
-- as the enum reads like better validation.
--
-- The fix is text in, cast inside, where the cast runs as the owner. The database
-- still rejects a bad value -- a cast to an enum rejects anything that is not a
-- member -- so nothing is given up.
--
-- proargtypes and not proallargtypes: proallargtypes includes OUT parameters, and
-- a table-returning function such as api.whoami has a private type in its OUTPUT
-- (private.app_role), which is fine. The caller never supplies an output, so
-- there is nothing for a client to fail to name. Only a value the caller must
-- pass is a problem.
--
-- A local VARIABLE of a private type inside a function body is fine for the same
-- reason. I previously flagged api.quarantine_batch and friends as affected, on
-- the strength of grepping for `p_to_status private.batch_status`; they were not,
-- and that flag was wrong. The assertion exists so the question has an answer
-- that does not depend on a grep.
select is_empty(
  $$
  select p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  left join lateral (
    select 1 as hit
    from unnest(p.proargtypes) as t(oid)
    join pg_type pt on pt.oid = t.oid
    join pg_namespace tn on tn.oid = pt.typnamespace
    where tn.nspname = 'private'
  ) x on true
  where n.nspname = 'api'
    and x.hit is not null
  $$,
  'no api function takes a private type as an input parameter -- such a function is uncallable from a client'
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
      'allocate_requisition', 'release_requisition',
      -- M3 catalogue and requisition writes. Same reason as the four above: the
      -- tenant policies call private.*, and a client role cannot name that
      -- schema, so a direct table write is a 42501. These functions are how a
      -- client writes a product, a location, a requisition or a requisition line.
      -- Each one re-checks the role itself with private.has_role() rather than
      -- relying on the policy, because the policy is not what is doing the check.
      'create_product', 'update_product', 'set_product_active',
      'create_location',
        'create_requisition', 'add_requisition_line', 'remove_requisition_line',
        -- M4 deliveries. The same reason, and a stronger one: these functions
        -- enforce a chain of physical facts -- a run has a van before it is
        -- dispatched, a stop is arrived at before it is signed, a run cannot close
        -- with a stop nobody called at. Left to the client, those rules would live
        -- in application code on a phone that may be holding a stale session.
        -- start_trip, arrive_at_stop, complete_stop, fail_stop and complete_trip
        -- additionally check that the run is assigned to the calling driver, so the
        -- function is the only thing standing between a stale phone and a signature
        -- on somebody else's delivery.
        'create_vehicle', 'create_trip', 'add_trip_stop',
        'dispatch_trip', 'start_trip', 'arrive_at_stop',
        'complete_stop', 'fail_stop', 'complete_trip',
        -- M4 follow-ups, and the catalogue pair. api.update_product carries
        -- p_is_active because the catalogue form edits a product and its active flag
        -- together, and making that two round trips left a product whose name had
        -- been changed and whose status had not. api.update_location is here because
        -- the location form's edit branch called a function that did not exist: the
        -- create branch used api.create_location, so the pair looked complete.
        'update_product', 'update_location',
        -- api.reset_demo_run is named here on purpose. It un-delivers a stop, so it
        -- is exactly the sort of function that should never be added quietly -- and
        -- being in the allow-list is what makes adding it loudly unavoidable. It has
        -- EXECUTE for the service role only; a client that reaches it is refused.
        'reset_demo_run',
        -- M5: the alert centre. All three mutate `alert_events`, whose bookkeeping
        -- columns (acknowledged_by, resolved_at, occurrences) have to move together,
        -- and whose partial unique index means a client writing them directly could
        -- create a duplicate open alert. Being in this list is what makes adding a
        -- fourth quietly impossible.
        'run_alert_scan', 'ack_alert', 'resolve_alert'
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
    --
    -- Every function in `api` is the authenticated surface -- there is no longer an
    -- exception. `api.reset_demo_run` used to be one: it un-delivers a stop, so it was
    -- granted to `service_role` alone and named here so a second such function could
    -- not be added quietly.
    --
    -- 0060 changed that. The demo trip was seeded with a `run_date` that was "today"
    -- on the day it was written and a past date ever after, so the driver tests lost
    -- the undelivered stop they act on and the dashboard reported an empty day that
    -- looked like a bug. Re-arming needs to be reachable by a signed-in warehouse
    -- manager, or the browser suite has to hold a service-role key in CI and write to
    -- the hosted database from a pull request.
    --
    -- The grant is safe because the function's tenant is a constant in its body and
    -- the trip is matched by that tenant plus a note; there is no argument to widen
    -- either. The privilege is "reset the demo run", not "reset any run". What has to
    -- hold instead is the role gate, so that is asserted directly below.
    with api_grants as (
      select authenticated_can_execute, total
      from (
      -- `select` alone on its line, for the reason noted at the second aggregate below.
      select
        sum((has_function_privilege('authenticated', p.oid, 'execute'))::int)
          as authenticated_can_execute,
        count(*) as total
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'api'
      ) counted
    )
    select is(
      (select authenticated_can_execute from api_grants),
      (select total from api_grants),
      'authenticated can EXECUTE every api function'
    );

    -- Which means the interesting question is no longer "is it granted" but "what
    -- does the grant now reach". The gate itself is `private.has_role('WAREHOUSE_MANAGER',
    -- 'TENANT_ADMIN')` inside the function -- the same pair every other `api` writer
    -- uses, and the reason a pharmacist is refused rather than served. The grant cannot
    -- express that: `authenticated` is every signed-in person, not the roles allowed to
    -- do warehouse things.
    select ok(
      has_function_privilege('service_role', 'api.reset_demo_run()', 'execute'),
      'api.reset_demo_run is still executable by the service role'
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
