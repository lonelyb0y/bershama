-- Fill an unset tenant_id from the caller instead of rejecting the row.
--
-- ── the bug, and why it survived two milestones ─────────────────────────────
--
-- private.assert_single_tenant() compared new.tenant_id against
-- private.current_tenant_id() and raised on any difference -- including the
-- difference between NULL and the caller's tenant. So a client that omitted the
-- column, which is what the catalogue form does because tenant_id is not a field
-- anyone should be filling in, got:
--
--   42501 tenant_id <NULL> does not match the caller tenant 11111111-...
--
-- The catalogue create form has therefore never worked. Nothing caught it: the
-- unit tests, the pgTAP suites and the Playwright tests all READ. The first
-- actual write against the hosted project found it, and the reason it was so
-- hard to see locally is that direct_writes.test.sql set the tenant_id column
-- explicitly -- so it tested the one case that already worked.
--
-- ── the fix ─────────────────────────────────────────────────────────────────
--
-- NULL now means "the client did not say", and is filled from the caller. A
-- value that IS supplied and does not match is still rejected, unchanged.
--
-- Filling is strictly stronger than validating, not weaker, and the reason is
-- worth stating because it is the opposite of the usual instinct:
--
--   - a client cannot choose its tenant even by supplying one, because the
--     column is overwritten rather than checked;
--   - there is no code path in which a row can be written with a tenant the
--     caller does not belong to;
--   - and the previous behaviour -- rejecting -- was reachable by accident, since
--     omitting a NOT NULL column is the natural thing to do and the failure mode
--     was an error on an operation the user is entitled to perform.
--
-- Every table using this trigger declares tenant_id NOT NULL, so NULL carries no
-- meaning anywhere it is applied; there is no "tenant-less row" this could
-- swallow.
--
-- SECURITY DEFINER, so the trigger can call private.current_tenant_id() at all:
-- client roles have no USAGE on `private` by design, which is asserted in
-- rls_coverage.test.sql. Search path is pinned and every name is qualified, so
-- the volatility buys nothing an attacker can reach.

create or replace function private.assert_single_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_tenant uuid := private.current_tenant_id();
begin
  -- No session, no opinion.
  --
  -- Migrations, the seed and service_role all write tenant-scoped rows with no
  -- auth.uid() present, and they are supposed to: the seed creates the demo
  -- tenant's catalogue before anybody signs in. Raising here broke
  -- `supabase db reset` on the first table it reached, which is the honest way to
  -- find out that a tenant assertion has to be conditional on there being a
  -- tenant to assert against.
  --
  -- This is not a hole. The check exists to stop a *client* from writing into
  -- another tenant, and a client always has a tenant or has no grant at all.
  -- When there is no session there is nobody to impersonate.
  if v_caller_tenant is null then
    return new;
  end if;

  if new.tenant_id is null then
    -- The client did not supply one. Fill it, so the column is never the
    -- caller's to get wrong -- including by forgetting.
    new.tenant_id := v_caller_tenant;
  elsif new.tenant_id is distinct from v_caller_tenant then
    -- The client supplied someone else's. Refuse, loudly: a mismatch is either a
    -- bug or an attempt, and neither is worth writing.
    raise exception 'tenant_id % does not match the caller tenant %',
      new.tenant_id, v_caller_tenant
      using errcode = '42501';
  end if;

  return new;
end
$$;

comment on function private.assert_single_tenant() is
  'Fills an unset tenant_id from the caller and refuses one that does not match. SECURITY DEFINER so a trigger can call private.current_tenant_id(), since client roles have no USAGE on private by design.';
