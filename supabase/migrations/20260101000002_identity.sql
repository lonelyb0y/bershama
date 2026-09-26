-- ============================================================================
-- 0002_identity.sql
-- tenants, profiles, invitations + RLS policies.
--
-- Multi-tenancy note: every table carries tenant_id and RLS is scoped to
-- private.current_tenant_id(). Tenant #1 is provisioned by the seed script; there
-- is no public signup route (see config.toml enable_signup = false). Adding a
-- second distributor is a second tenant row, with no schema change.
-- ============================================================================

-- ── tenants ─────────────────────────────────────────────────────────────────

create table public.tenants (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique
                check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  name_en       text not null check (length(btrim(name_en)) > 0),
  name_ar       text,
  country_code  char(2) not null default 'EG',
  -- Money is stored as integer minor units (piastres for EGP). Never floats:
  -- rounding drift on a ledger of money is unacceptable.
  currency_code char(3) not null default 'EGP',
  -- VAT is a tenant setting, never hardcoded. Rates change.
  vat_rate      numeric(5,2) not null default 0 check (vat_rate between 0 and 100),
  timezone      text not null default 'Africa/Cairo',
  locale_default text not null default 'en' check (locale_default in ('en','ar')),
  -- FEFO must not allocate stock that is already close to expiry. A pharmacist
  -- receiving a 3-week-old box is a complaint; a 3-week-old box that expires in
  -- their pharmacy is a regulatory problem. Percentage of total shelf life.
  min_shelf_life_pct  numeric(5,2) not null default 25
                check (min_shelf_life_pct between 0 and 100),
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.tenants is
  'A distributor company. PharmaFlow supports many; the pilot runs exactly one.';

-- ── profiles ────────────────────────────────────────────────────────────────
-- Supabase owns the credentials in auth.users. This table holds everything the
-- product needs. Authorization decisions read `role` from here and never from
-- JWT claims, because raw_user_meta_data is editable by the user.
--
-- The columns that the RLS helper functions depend on (id, tenant_id, role,
-- full_name, is_active) are declared in 0001 as a forward declaration, because
-- Postgres validates a function body at CREATE time and private.current_tenant_id()
-- has to be able to reference this table. Everything else is added here.

alter table public.profiles
  add column if not exists full_name_ar text,
  add column if not exists phone       text,
  add column if not exists locale      text not null default 'en',
  add column if not exists last_seen_at timestamptz,
  add column if not exists created_at  timestamptz not null default now(),
  add column if not exists updated_at  timestamptz not null default now();

-- The remaining constraints can only be added once the columns exist.
alter table public.profiles
  add constraint profiles_full_name_present check (length(btrim(full_name)) > 0),
  add constraint profiles_locale_valid check (locale in ('en', 'ar'));

-- tenant_id gains its real foreign key now that public.tenants exists.
alter table public.profiles
  add constraint profiles_tenant_id_fkey
  foreign key (tenant_id) references public.tenants (id) on delete cascade;

comment on table public.profiles is
  'Application-side user profile. Keyed to auth.users, no credential material.';

-- A user belongs to exactly one tenant. Enforced here so that even a bug in the
-- request path cannot create a profile that points at a second tenant.
create or replace function private.assert_single_tenant()
returns trigger
language plpgsql
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
  return new;
end;
$$;

create trigger profiles_enforce_tenant
  before insert or update of tenant_id on public.profiles
  for each row execute function private.assert_single_tenant();

-- ── invitations ─────────────────────────────────────────────────────────────
-- Invite-only onboarding. A TENANT_ADMIN issues one; Supabase Auth sends the
-- email; the invited person sets a password and lands in their tenant with the
-- role that was pre-assigned here.

create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  email       text not null check (position('@' in email) > 1),
  role        private.app_role not null,
  full_name   text not null check (length(btrim(full_name)) > 0),
  facility_id uuid, -- set in a later migration once facilities exist
  invited_by  uuid references public.profiles (id) on delete set null,
  token_hash  text not null,
  status      text not null default 'pending'
              check (status in ('pending','accepted','revoked','expired')),
  expires_at  timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);

create index invitations_tenant_id_idx on public.invitations (tenant_id);
create index invitations_email_idx on public.invitations (email);

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger tenants_touch_updated_at
  before update on public.tenants
  for each row execute function private.touch_updated_at();

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function private.touch_updated_at();

-- ── Grants ──────────────────────────────────────────────────────────────────
-- A new table in `public` inherits full grants for anon and authenticated.
-- Revoke first, then grant back exactly what the app needs. Adding policies does
-- NOT remove grants, so this ordering is the part that actually matters.

revoke all on table public.tenants, public.profiles, public.invitations
  from anon, authenticated;

-- Anyone signed in may read their own tenant row (to render name, currency, VAT).
grant select on table public.tenants to authenticated;

-- Profiles: a user reads their own row; TENANT_ADMIN reads all in the tenant.
--
-- UPDATE is granted to authenticated because a user must be able to correct
-- their own name and phone number, and because api.update_my_profile() runs as
-- the caller. This grant is safe on its own: the RLS policies below confine the
-- operation to the caller's own row, and the UPDATE policy's WITH CHECK clause
-- pins role and tenant_id so a self-service edit cannot escalate privileges.
-- Without this grant, api.update_my_profile() would fail with
-- "permission denied for table profiles".
grant select, update on table public.profiles to authenticated;

-- Invitations: readable and manageable by admins only. No client-side insert —
-- creating an invite goes through api.invite_user(), which also sends the email
-- and records the audit entry, so there is exactly one path.
grant select, update, delete on table public.invitations to authenticated;

-- Sequences: needed for identity columns if we ever add one. Harmless to grant,
-- but explicit rather than relying on inherited defaults.
grant usage, select on all sequences in schema public to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.tenants      enable row level security;
alter table public.profiles     enable row level security;
alter table public.invitations  enable row level security;

-- tenants: read your own. Not writable from the client; settings changes go
-- through api.update_tenant_settings() so they are audited.
create policy "read own tenant"
  on public.tenants for select
  to authenticated
  using (id = (select private.current_tenant_id()));

-- profiles: read your own row always.
create policy "read own profile"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

-- profiles: an admin reads everyone else in the same tenant.
create policy "admins read tenant profiles"
  on public.profiles for select
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role('TENANT_ADMIN'))
  );

-- profiles: update your own row, but you may not change your own role or tenant.
-- WITH CHECK is what prevents privilege escalation: it validates the row as it
-- would be AFTER the update.
create policy "update own profile"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role = (select private.current_role())
    and tenant_id = (select private.current_tenant_id())
  );

-- invitations: admins manage their tenant's invitations.
create policy "admins read invitations"
  on public.invitations for select
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role('TENANT_ADMIN'))
  );

create policy "admins revoke invitations"
  on public.invitations for update
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role('TENANT_ADMIN'))
  )
  with check (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role('TENANT_ADMIN'))
  );

create policy "admins delete invitations"
  on public.invitations for delete
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role('TENANT_ADMIN'))
  );
