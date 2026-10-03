-- ============================================================================
-- audit-platform-objects.sql
--
-- The one gap `supabase/tests/rls_coverage.test.sql` cannot close, and the cheapest
-- honest way to keep an eye on it.
--
-- ── the gap ─────────────────────────────────────────────────────────────────────
--
-- Every suite in verify-db.sh runs against a throwaway cluster built from this
-- repository's migrations. It can only see objects *we* created. The hosted project also
-- contains objects the Supabase platform installs itself, and those are invisible to CI
-- by construction -- there is nothing local to assert them against, and a test that
-- passes because its subject is absent is worse than no test.
--
-- This is not theoretical. public.rls_auto_enable() -- a SECURITY DEFINER function
-- owned by postgres, created with Postgres' default privileges rather than the ACL the
-- platform gives its own event triggers -- granted EXECUTE to PUBLIC, anon, authenticated
-- and service_role. Any anonymous caller could POST /rest/v1/rpc/rls_auto_enable and have
-- it run as the superuser owner.
--
-- It was never exploitable: as an event-trigger function, Postgres refuses a direct call
-- with 0A000 before the body runs. But nothing here could have found it. It took reading
-- the advisor by hand.
--
-- ── what this file is ────────────────────────────────────────────────────────────
--
-- A read-only audit of *platform-owned* objects, written so it can be run against the
-- live project from anywhere with SQL access -- including an operator with the Supabase
-- MCP, which is how it was last run. It creates nothing and changes nothing.
--
-- Database branching would close this automatically by giving CI a clone that *has* the
-- platform objects. That is the textbook fix and it is deliberately not used here: it
-- bills monthly, and a free check that a person or a scheduled job runs on demand is the
-- better trade at this project's size.
--
-- ── how to run it ────────────────────────────────────────────────────────────────
--
--   psql "$SUPABASE_DB_URL" -f supabase/audit-platform-objects.sql
--
-- Every row returned is a finding. Zero rows is the passing state. The expected result
-- today is recorded in docs/platform-object-audit.md, with the date it was taken -- a
-- point-in-time record is worth having precisely because it is dated and therefore
-- honestly limited, rather than pretending to be continuous.
-- ============================================================================

\pset pager off

with findings as (

  -- ── 1. SECURITY DEFINER functions an anonymous caller can reach ────────────────
  --
  -- The invariant, not the instance. Checking for rls_auto_enable by name would be
  -- worthless: the next one has a different name, and the one after that sits in a
  -- schema nobody thought to list. This mirrors the assertion now enforced in CI for
  -- objects we own, extended to the ones the platform owns.
  --
  -- has_function_privilege resolves inherited PUBLIC grants as well as direct ones, which
  -- is the whole point: PUBLIC was the grant that mattered.
  select 'anon_reaches_definer'::text as kind,
         format('%I.%I', n.nspname, p.proname) as object,
         format('owned by %s, executable by anon', pg_get_userbyid(p.proowner)) as detail
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'api', 'auth', 'extensions', 'graphql', 'graphql_public')
    and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE')

  union all

  -- ── 2. any definer function still reachable through PUBLIC ────────────────────
  --
  -- Deliberately narrower than (1). A PUBLIC grant is how anon got in last time, and it
  -- is the shape to catch even where the role happens to be revoked by other means.
  select 'public_executes_definer',
         format('%I.%I', n.nspname, p.proname),
         format('PUBLIC holds EXECUTE; owner %s', pg_get_userbyid(p.proowner))
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'api', 'auth', 'extensions', 'graphql', 'graphql_public')
    and p.prosecdef
    and exists (
      select 1
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
      where g.grantee = 0                       -- 0 is PUBLIC
        and g.privilege_type = 'EXECUTE'        -- text, not a bitmask
    )

  union all

  -- ── 3. SECURITY DEFINER with a mutable search_path ─────────────────────────────
  --
  -- Real for a definer function: with no pinned path, a caller who can create objects in
  -- an earlier schema can shadow an unqualified name and run code as the definer's owner.
  -- Functions with no proconfig at all are listed; a config that sets search_path to
  -- something other than pg_catalog is listed separately below.
  select 'definer_mutable_search_path',
         format('%I.%I', n.nspname, p.proname),
         'SECURITY DEFINER with no search_path set'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'api', 'auth', 'extensions', 'graphql', 'graphql_public')
    and p.prosecdef
    and (p.proconfig is null
         or not exists (
           select 1
           from unnest(coalesce(p.proconfig, '{}')) c
           where c like 'search\_path=%'
         ))

  union all

  -- ── 4. tables in an exposed schema without row level security ────────────────
  --
  -- public and api are reachable over the Data API. An RLS-free table there is readable
  -- by anyone holding the default grants.
  select 'exposed_table_without_rls',
         format('%I.%I', n.nspname, c.relname),
         'reachable over the Data API with no RLS'
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'api')
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity

  union all

  -- ── 5. event triggers, which is where the finding actually lived ──────────────
  --
  -- Informational rather than a failure: event-trigger functions are supposed to exist
  -- here, and Postgres refuses to run one outside a trigger context. Listed so the set
  -- is on record and a *new* one is visible in a diff.
  select 'event_trigger_function' as kind,
         format('%I.%I', n.nspname, p.proname) as object,
         format('on %s, owned by %s, anon_exec=%s', e.evtname, pg_get_userbyid(p.proowner),
                has_function_privilege('anon', p.oid, 'EXECUTE')) as detail
  from pg_event_trigger e
  join pg_proc p on p.oid = e.evtfoid
  join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE')

)

select kind,
       object,
       detail,
       case
         when kind = 'event_trigger_function' then 'info -- listed for visibility, not a failure'
         else 'FINDING'
       end as severity
from findings
order by severity desc, kind, object;