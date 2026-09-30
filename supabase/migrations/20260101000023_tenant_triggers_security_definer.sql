-- Make the tenant-assertion triggers SECURITY DEFINER, so direct table writes work.
--
-- ── the bug ─────────────────────────────────────────────────────────────────
--
-- Every tenant-bearing table has a BEFORE trigger that calls
-- private.current_tenant_id(), and that function lives in a schema `authenticated`
-- has no USAGE on (rls_coverage.test.sql asserts exactly that, and it is the
-- right assertion). A trigger function declared SECURITY INVOKER -- which is the
-- default, and which is what all of these were -- runs with the invoking role's
-- privileges, so resolving `private.current_tenant_id()` fails:
--
--   42501 permission denied for schema private
--
-- which means a signed-in user could not insert a product, a requisition or a
-- requisition line at all. Every write through the catalogue form returned 403.
--
-- ── why it survived so long ─────────────────────────────────────────────────
--
-- M1's writes went through api.* functions, which are SECURITY DEFINER, so the
-- direct path was never exercised. M2 shipped a catalogue create form that calls
-- the table directly -- correctly, since RLS is the right mechanism for it -- and
-- the 181 unit tests, 169 pgTAP assertions and 33 Playwright tests all passed,
-- because every one of them READ. The first actual write against the hosted
-- project found it.
--
-- The Playwright suite now creates a product through the form, so the next thing
-- like this is caught in CI rather than by hand.
--
-- ── the fix and its cost ────────────────────────────────────────────────────
--
-- SECURITY INVOKER would be the safer default, but it cannot work while the
-- private schema is unreachable by design. So these run as their owner, which is
-- only safe because:
--
--   - `set search_path = ''` is pinned, so nothing in a writable schema can be
--     resolved in place of a private one;
--   - every name in these bodies is schema-qualified;
--   - the assertion is a COMPARISON, not an assignment: it refuses a tenant_id
--     that differs from the caller's, and never widens what a row may hold.
--
-- The requisition triggers do assign (`new.tenant_id := current_tenant_id()`),
-- which is the stronger claim, and that is safe for the same reason plus the
-- fact that the assignment overwrites rather than preserves whatever the client
-- sent: a client cannot choose its tenant, even by supplying one.
--
-- They live in `private`, not `public`, and that is enforced:
-- rls_coverage.test.sql asserts that no SECURITY DEFINER function sits in the
-- public schema, because `public` is the schema a client can see. A definer
-- function in a client-visible schema is a privilege anyone can look at.

-- ── existing tables ─────────────────────────────────────────────────────────

create or replace function private.assert_single_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_tenant uuid := private.current_tenant_id();
begin
  if v_caller_tenant is not null
     and new.tenant_id is distinct from v_caller_tenant then
    raise exception 'tenant_id % does not match the caller tenant %',
      new.tenant_id, v_caller_tenant
      using errcode = '42501';
  end if;

  -- No explicit return: a BEFORE trigger that returns null would skip the
  -- operation entirely, so the row variable is returned as-is.
  return new;
end
$$;

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
