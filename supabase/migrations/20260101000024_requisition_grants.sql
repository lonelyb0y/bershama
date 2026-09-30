-- Grant the requisition tables, and move their triggers into `private`.
--
-- Two omissions in 0023, both found by running a real insert as `authenticated`
-- rather than by reading the SQL:
--
-- 1. RLS decides WHICH rows a client may touch; the GRANT decides whether it can
--    touch any. 0018 wrote correct policies on two tables nobody had been given
--    any privilege on, so every insert returned
--    "permission denied for table requisitions". Policies alone are not access.
--
-- 2. The requisition trigger functions were SECURITY DEFINER in `public`, and
--    rls_coverage.test.sql asserts that no SECURITY DEFINER function sits in
--    `public` -- the schema a client can see. Moved to `private`, where
--    private.assert_single_tenant already lived and worked.
--
-- Also restates private.assert_single_tenant, because 0023 was applied to the
-- hosted project before these corrections and a migration that has run is not
-- re-run by editing it.

-- ── requisitions ────────────────────────────────────────────────────────────

create or replace function private.set_requisition_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Overwrite rather than validate. A client that sends a tenant_id gets its own
  -- tenant written over the top, which is stronger than refusing the row: there
  -- is no code path where a caller can influence this column at all.
  new.tenant_id := (select private.current_tenant_id());
  return new;
end
$$;

create or replace function private.set_requisition_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only filled when absent, so a batch import that runs as service_role can
  -- attribute a request to somebody else. A client cannot: for a client
  -- auth.uid() is the only value available, and this column is not in the form.
  if new.requested_by is null then
    new.requested_by := (select auth.uid());
  end if;
  return new;
end
$$;

create or replace function private.set_requisition_line_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.tenant_id := (select private.current_tenant_id());
  return new;
end
$$;

comment on function private.assert_single_tenant() is
  'Refuses a row whose tenant_id differs from the caller''s. SECURITY DEFINER so it can call private.current_tenant_id() from a trigger, since client roles have no USAGE on private by design.';
comment on function private.set_requisition_tenant() is
  'Overwrites tenant_id with the caller''s, so no client can choose its tenant. SECURITY DEFINER for the same reason as private.assert_single_tenant().';

-- The triggers themselves are unchanged -- only the functions they call.
drop trigger if exists products_enforce_tenant on public.products;
create trigger products_enforce_tenant
  before insert or update of tenant_id on public.products
  for each row execute function private.assert_single_tenant();

drop trigger if exists requisitions_set_tenant on public.requisitions;
create trigger requisitions_set_tenant
  before insert on public.requisitions
  for each row execute function private.set_requisition_tenant();

drop trigger if exists requisitions_set_actor on public.requisitions;
create trigger requisitions_set_actor
  before insert on public.requisitions
  for each row execute function private.set_requisition_actor();

drop trigger if exists requisition_lines_set_tenant on public.requisition_lines;
create trigger requisition_lines_set_tenant
  before insert on public.requisition_lines
  for each row execute function private.set_requisition_line_tenant();

-- The 0018 versions were in `public` and are now redundant. Dropped rather than
-- left in place: a SECURITY DEFINER function in a client-visible schema is the
-- thing the rls suite exists to prevent, and leaving one "just in case" is how
-- it comes back.
drop function if exists public.set_requisition_tenant();
drop function if exists public.set_requisition_actor();
drop function if exists public.set_requisition_line_tenant();

-- ── table grants ────────────────────────────────────────────────────────────
--
-- RLS decides WHICH rows a client may touch; the grant decides WHETHER it can
-- touch any. A table with policies and no grant is unreachable, which is the
-- state 0018 left the requisition tables in: every policy was correct and every
-- insert returned "permission denied for table requisitions".
--
-- The privileges mirror the policies exactly rather than being blanket:
--
--   requisitions       select + insert + update   -- no delete. A request is
--                       discarded or rejected, never removed; a requisition that
--                       has been allocated is the evidence that stock moved.
--   requisition_lines  select + insert + update + delete
--                       -- lines are removed freely, but only while their parent
--                       is a DRAFT, which the delete policy enforces.
--
-- No DELETE on requisitions is a deliberate asymmetry with requisition_lines, and
-- the comment above is the reason: a line is scratch work in a draft, a
-- requisition is a record.
grant select, insert, update on table public.requisitions to authenticated;
grant select, insert, update, delete on table public.requisition_lines to authenticated;
