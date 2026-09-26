-- ============================================================================
-- 0001_foundation.sql
-- Schemas, roles, enums, and the RLS helper layer.
--
-- SCHEMA LAYOUT (see docs/adr/0002-rls-and-privileged-functions.md):
--
--   private  Privileged implementation. SECURITY DEFINER functions only.
--            NOT in the exposed schema list, so these are NOT reachable over the
--            Data API. Never put a table the client should read in here.
--   api      Thin SECURITY INVOKER wrappers. This is the only application-facing
--            function surface, and it is the only extra schema we expose.
--   public   Tables + RLS policies. What the client reads and writes.
--   auth     Supabase-managed. Never touch.
--   storage  Supabase-managed. Policies added in a later migration.
--
-- Why the split matters: a SECURITY DEFINER function runs with the privileges of
-- its owner (postgres, which has BYPASSRLS). Supabase exposes every schema in the
-- project's "Exposed schemas" API setting to the Data API. If such a function sits
-- in an exposed schema, any signed-in client can call it and act as postgres.
-- Keeping them in `private` and exposing only `api` removes that class of bug.
-- ============================================================================

-- ── Schemas ─────────────────────────────────────────────────────────────────

create schema if not exists private;
comment on schema private is
  'Privileged internals. SECURITY DEFINER only. Never exposed to the Data API.';

create schema if not exists api;
comment on schema api is
  'Thin client-callable wrappers over private.* logic. The only app function surface.';

-- private must never be reachable by the API roles.
revoke all on schema private from public;

-- Clients may use `api` (to call wrappers) and `public` (tables/views).
grant usage on schema public to anon, authenticated;
grant usage on schema api to authenticated;

-- ── Enumerations ────────────────────────────────────────────────────────────

create type private.app_role as enum (
  'TENANT_ADMIN',    -- full control of the tenant: users, facilities, settings
  'WAREHOUSE_MANAGER', -- approvals, allocation, dispatch, stock adjustments
  'DISPATCHER',      -- builds routes, assigns drivers, monitors trips
  'PHARMACY_MANAGER',-- creates and submits requisitions for its own facility
  'DISTRIBUTOR',     -- driver: executes stops, captures proof of delivery
  'ANALYST'          -- read-only across dashboards and reports
);

create type private.facility_kind as enum (
  'WAREHOUSE', 'PHARMACY', 'HOSPITAL', 'CLINIC'
);

create type private.location_kind as enum (
  'RECEIVING', 'QUARANTINE', 'AMBIENT', 'COLD', 'FREEZER', 'IN_TRANSIT', 'BIN', 'DISPENSE'
);

create type private.batch_status as enum (
  'QUARANTINED', -- received, not yet released for sale/supply
  'RELEASED',    -- available for FEFO allocation
  'RECALLED',    -- withdrawn by a recall; never allocatable
  'EXPIRED',     -- past expiry
  'DEPLETED'     -- fully consumed
);

-- ── Auth helper functions ───────────────────────────────────────────────────
--
-- All are STABLE + SECURITY DEFINER so that:
--   1. RLS policies can read `profiles` without recursing (profiles' own policy
--      calls these functions; without DEFINER the reads would re-enter the policy
--      and Postgres raises 42P17 "infinite recursion detected in policy").
--   2. The `(select ...)` call form in policies lets the planner hoist the call
--      into an initPlan and evaluate it once per statement instead of once per row.
--
-- `search_path = ''` on every one: without a pinned search_path a caller can point
-- an unqualified name at their own object and run it with the function owner's
-- privileges. Every name inside is schema-qualified.

-- Reading a custom GUC this way is exactly how the real auth.uid() behaves, so a
-- policy that works here works there.
--
-- ORDERING NOTE: these functions reference public.profiles, which is created in
-- 0002_identity.sql. Postgres validates a function body at CREATE time, so the
-- table must already exist. Profiles is therefore declared in this file as a
-- forward declaration and 0002 fills in its columns, policies and triggers. The
-- alternative -- moving the helpers into 0002 -- would leave 0001 with policies
-- that cannot compile, which is worse.

create table if not exists public.profiles (
  id        uuid primary key references auth.users (id) on delete cascade,
  tenant_id uuid not null,
  role      private.app_role not null,
  full_name text not null,
  is_active boolean not null default true
);

create index if not exists profiles_tenant_id_idx on public.profiles (tenant_id);

create or replace function private.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.tenant_id
  from public.profiles p
  where p.id = (select auth.uid())
    and p.is_active
$$;

comment on function private.current_tenant_id() is
  'Tenant of the calling user, or NULL when unauthenticated/inactive.';

create or replace function private.current_role()
returns private.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
    and p.is_active
$$;

comment on function private.current_role() is
  'Role of the calling user. Read from the profiles table, never from JWT claims, '
  'because raw_user_meta_data is user-editable.';

create or replace function private.has_role(variadic roles private.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_role() = any(roles), false)
$$;

comment on function private.has_role is
  'True when the caller holds any of the given roles. Used inside RLS policies.';

-- Roles permitted to move stock. Kept in one place so a policy change is a
-- single edit rather than a search across dozens of policies.
create or replace function private.can_write_inventory()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.current_role() in ('TENANT_ADMIN', 'WAREHOUSE_MANAGER'),
    false
  )
$$;

-- ── Time helpers ────────────────────────────────────────────────────────────

create or replace function private.now_utc()
returns timestamptz
language sql
stable
as $$
  select now()
$$;

comment on function private.now_utc() is
  'All stored timestamps are timestamptz in UTC. Rendering in the tenant timezone '
  'is the client''s job, not the database''s.';
