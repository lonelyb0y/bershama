-- Take public.rls_auto_enable() off the client-reachable surface.
--
-- ── what the advisor said ──────────────────────────────────────────────────────
--
-- "Public Can Execute SECURITY DEFINER Function": public.rls_auto_enable() can be
-- executed by the anon role as a SECURITY DEFINER function via
-- /rest/v1/rpc/rls_auto_enable.
--
-- ── why it was reachable ───────────────────────────────────────────────────────
--
-- Every other event-trigger function on this database -- pgrst_ddl_watch(),
-- pgrst_drop_watch(), set_graphql_placeholder(), grant_pg_cron_access(),
-- grant_pg_net_access(), grant_pg_graphql_access() -- is owned by `supabase_admin`
-- and grants EXECUTE to `supabase_admin` alone. rls_auto_enable() was the only one owned
-- by `postgres`, and it granted EXECUTE to PUBLIC, anon, authenticated and service_role.
-- Those are Postgres' defaults for CREATE FUNCTION, so this was not a deliberate grant;
-- it was a function created without the ACL the platform gives its own.
--
-- The consequence is that any anonymous internet caller could POST to
-- /rest/v1/rpc/rls_auto_enable and have the function run as the superuser owner.
--
-- ── why it was never exploitable ────────────────────────────────────────────────
--
-- Checked rather than assumed. It is an event-trigger function, so calling it outside a
-- DDL event context fails:
--
--   ERROR 0A000: trigger functions can only be called as triggers
--
-- Postgres refuses before the body executes, so no statement in it ever ran with
-- elevated rights. The exposure was an error oracle on the public API surface, not a
-- privilege-escalation path.
--
-- It is still fixed, for three reasons. An anon-reachable superuser-owned definer is one
-- refactor away from being a real one: the moment that function stopped calling
-- pg_event_trigger_ddl_commands(), or was given arguments, the guard would be gone and
-- nothing would fail loudly. It is noise on the error surface. And a security advisor
-- that reports a true positive on every run trains people to ignore it on the day it
-- matters.
--
-- ── why the trigger still fires ─────────────────────────────────────────────────
--
-- Trigger invocation does not check the EXECUTE privilege of the role whose DDL caused
-- it -- only CREATE TRIGGER / CREATE EVENT TRIGGER does. So revoking is invisible to the
-- trigger. supabase/tests/rls_auto_enable.test.sql proves that by creating a table and
-- asserting RLS came on by itself, without this migration granting anything back.

-- Guarded because this function belongs to the platform, not to us. It exists on the
-- hosted project and its `ensure_rls` event trigger, and not in scripts/verify-db.sh's
-- throwaway cluster, which is bare Postgres. Without the guard this migration fails
-- there with "function public.rls_auto_enable() does not exist".
--
-- The consequence is worth being blunt about: the revoke below is therefore only ever
-- *executed* against the hosted project, and nothing in CI can prove it took effect.
-- What does cover it is the Supabase security advisor, which runs against hosted and
-- which is how this was found. See the note in supabase/tests/rls_coverage.test.sql
-- about the blind spot that creates.
do $$
begin
  if exists (
    select 1 from pg_proc p
    where p.proname = 'rls_auto_enable'
      and p.pronamespace = 'public'::regnamespace
  ) then
    revoke execute on function public.rls_auto_enable()
      from public, anon, authenticated, service_role;

    -- Guarded for the same reason as the revoke above.
    comment on function public.rls_auto_enable() is
      'Event-trigger function for the ensure_rls event trigger. Not client-callable: '
      'Postgres rejects direct invocation with 0A000 regardless. EXECUTE is revoked from '
      'PUBLIC/anon/authenticated/service_role deliberately; trigger firing does not depend '
      'on it.';
  else
    raise notice 'public.rls_auto_enable() is absent here (bare cluster); nothing to revoke';
  end if;
end $$;

-- ── pin search_path on the private trigger functions ────────────────────────────
--
-- Also flagged: private.now_utc(), private.touch_updated_at(), private.deny_audit_mutation()
-- have a mutable search_path. To be clear about the severity, all three are trigger
-- functions and none is SECURITY DEFINER, so there is no privilege to escalate here --
-- this is hygiene, and silencing a linter that is otherwise reporting one true positive
-- per run. pg_catalog is where every identifier they use already resolves from, so
-- pinning changes no behaviour and cannot change resolution into something else.
--
-- The `SET search_path` on the function is the same value the platform's own functions
-- use, so this matches the house style rather than inventing a new convention.

alter function private.now_utc()            set search_path = pg_catalog;
alter function private.touch_updated_at()   set search_path = pg_catalog;
alter function private.deny_audit_mutation() set search_path = pg_catalog;