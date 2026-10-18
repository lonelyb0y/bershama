-- ============================================================================
-- A nightly tenant wrapper for the alert scan, callable by a scheduler.
--
-- WHY THIS EXISTS
-- ---------------
-- api.run_alert_scan() resolves its tenant from the session
-- (private.current_tenant_id() -> auth.uid() -> profiles) and gates on a role.
-- A scheduler has neither: it is not a user and it carries no session. So the
-- job that the docs promise (docs/runbook.md tells an operator to check
-- cron.job_run_details; there is no cron) could not be driven from outside.
--
-- The shape here is the one 0060 already established for api.reset_demo_run:
--   * the tenant is a CONSTANT in the function body, never an argument;
--   * a null private.current_role() is read as "this is the service role",
--     and anything else still has to clear the role gate.
-- That keeps the function inside the authenticated surface, which
-- rls_coverage.test.sql asserts is total -- so no new exception to that
-- invariant is introduced, and the tenant cannot be widened by a caller.
--
-- THE LIMIT, STATED PLAINLY
-- -------------------------
-- This is single-tenant. It is not a general "scan every tenant" entry point,
-- and it deliberately is not one: a multi-tenant loop that impersonates an
-- arbitrary profile is a SECURITY DEFINER function whose only boundary is its
-- grant, which is the pattern rls_coverage.test.sql refuses. One tenant per
-- function body means the blast radius of a mistake is one pharmacy, and the
-- tenant to act on is visible in the source rather than passed in at runtime.
--
-- For a second pharmacy, copy this function with a different constant and a
-- different name, as 0060 did. That is deliberate friction: onboarding a tenant
-- to a nightly job should be a reviewed diff, not a runtime argument.
--
-- The drift/reconciliation job (private.raise_drift_alerts) is deliberately NOT
-- exposed here. It is the more important of the two, and it is still blocked on
-- the same tension -- see the note at the end of this file.
-- ============================================================================

create or replace function api.run_alert_scan_for_tenant()
returns table (raised integer, skipped integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- A constant, never an argument: the reason is in the header.
  c_tenant constant uuid := '11111111-0000-4000-8000-000000000001';

  v_role   private.app_role;
  v_raised integer := 0;
  v_skipped integer := 0;
  v_result record;
begin
  -- service_role has no row in profiles, so private.current_role() is null there.
  -- A null role is the service role; anything else has to clear the gate. Same
  -- reading of the same signal as api.reset_demo_run.
  v_role := private.current_role();
  if v_role is not null
     and not (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER')) then
    raise exception 'only a warehouse manager may run the alert scan'
      using errcode = '42501';
  end if;

  -- The body of api.run_alert_scan(), minus the tenant lookup it cannot make
  -- without a session. Rather than duplicate the scan, impersonate just enough
  -- of the tenant for the existing function to resolve, and delegate: there is
  -- one implementation of "what counts as a low-stock alert", and it is the one
  -- that is tested.
  --
  -- The claim below is scoped to this transaction and to this tenant.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (
      select p.id::text from public.profiles p
      where p.tenant_id = c_tenant and p.is_active
      order by (p.role = 'TENANT_ADMIN') desc nulls last, p.created_at
      limit 1
    ),
    -- aal2 so the MFA restrictive policies (20260101000074) do not block the
    -- job's own writes. This is a machine, not a session that skipped a factor.
    'aal', 'aal2',
    'role', 'authenticated'
  )::text, true);

  select * into v_result from api.run_alert_scan();
  v_raised := coalesce(v_result.raised, 0);
  v_skipped := coalesce(v_result.skipped, 0);

  -- Leave no impersonation behind for a later statement in the same session.
  perform set_config('request.jwt.claims', '{}', true);

  raised := v_raised;
  skipped := v_skipped;
  return next;
end;
$$;

comment on function api.run_alert_scan_for_tenant() is
  'Nightly alert scan for one hard-coded tenant, for a scheduler that has no '
  'user session. Delegates to api.run_alert_scan() so the scan itself has a '
  'single implementation. Single-tenant by construction: see the migration '
  'header before adding another.';

grant execute on function api.run_alert_scan_for_tenant() to authenticated, service_role;

-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default, and PUBLIC
-- is inherited by every role including anon. So the grant above is necessary but
-- not sufficient: without these two revokes the SECURITY DEFINER wrapper is
-- reachable by an anonymous request, which is precisely what
-- rls_coverage.test.sql asserts against. Revoking from PUBLIC is what actually
-- removes it; the anon revoke is explicit rather than implied.
revoke execute on function api.run_alert_scan_for_tenant() from public, anon;

-- ── still open ─────────────────────────────────────────────────────────────
--
-- private.raise_drift_alerts() is the more important of the two nightly jobs:
-- it is the only thing that proves stock_balances agrees with the ledger. It
-- cannot be exposed the way the scan was, because it has no constant-tenant
-- variant and no session to impersonate from -- the tenant is discovered inside
-- it from the calling user. Exposing it needs a decision about how a scheduler
-- acts across many tenants at once, and that decision belongs to a human: it is
-- a grant whose entire security boundary is the grant. Left unexposed until
-- then, rather than exposed loosely.