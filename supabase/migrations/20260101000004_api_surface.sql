-- ============================================================================
-- 0004_api_surface.sql
-- The client-callable function surface.
--
-- Every function here is SECURITY INVOKER, meaning it runs as the calling role
-- (authenticated) and is therefore bound by RLS like any other statement. The
-- wrappers exist so the client has a small, stable, auditable set of entry
-- points, while the real logic lives in `private` where it cannot be reached.
--
-- Anything in this file that performs a privileged write must delegate to
-- private.* and still respect the caller's tenant. Getting a function's
-- search_path wrong is the difference between tenant isolation and no isolation,
-- so: search_path = '' on every function, and every name schema-qualified.
-- ============================================================================

-- ── session bootstrap ───────────────────────────────────────────────────────
-- One round trip on sign-in: who am I, which tenant, what role, what locale.

create or replace function api.whoami()
returns table (
  user_id    uuid,
  tenant_id  uuid,
  role       private.app_role,
  full_name  text,
  locale     text,
  tenant_slug text,
  currency_code char(3),
  vat_rate   numeric,
  timezone   text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (select auth.uid()),
    t.id,
    p.role,
    p.full_name,
    p.locale,
    t.slug,
    t.currency_code,
    t.vat_rate,
    t.timezone
  from public.profiles p
  join public.tenants t on t.id = p.tenant_id
  where p.id = (select auth.uid())
    and p.is_active
$$;

comment on function api.whoami() is
  'Current identity, tenant and role in one call. Returns zero rows when '
  'unauthenticated or the profile is inactive.';

-- ── tenant settings ─────────────────────────────────────────────────────────
-- Settings changes are audited, so this is a function rather than a direct
-- UPDATE policy on public.tenants.

create or replace function api.update_tenant_settings(p_patch jsonb)
returns public.tenants
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after  public.tenants;
  v_tenant uuid := (select private.current_tenant_id());
begin
  if not (select private.has_role('TENANT_ADMIN')) then
    raise exception 'only a TENANT_ADMIN can change tenant settings'
      using errcode = '42501';
  end if;

  select to_jsonb(t) into v_before from public.tenants t where t.id = v_tenant;

  update public.tenants t
  set name_en        = coalesce(p_patch->>'name_en',        t.name_en),
      name_ar        = coalesce(p_patch->>'name_ar',        t.name_ar),
      vat_rate       = coalesce((p_patch->>'vat_rate')::numeric, t.vat_rate),
      timezone       = coalesce(p_patch->>'timezone',       t.timezone),
      locale_default = coalesce(p_patch->>'locale_default', t.locale_default),
      min_shelf_life_pct =
        coalesce((p_patch->>'min_shelf_life_pct')::numeric, t.min_shelf_life_pct),
      settings       = t.settings || coalesce(p_patch->'settings', '{}'::jsonb)
  where t.id = v_tenant
  returning * into v_after;

  perform private.write_audit(
    'tenant.settings_updated', 'tenant', v_tenant::text, v_before, to_jsonb(v_after)
  );

  return v_after;
end;
$$;

-- ── profile self-service ────────────────────────────────────────────────────
-- Updating your own name/phone/locale. Role and tenant are NOT updatable here;
-- the profiles UPDATE policy blocks that even if someone calls the table
-- directly. This wrapper exists so the change is audited.

create or replace function api.update_my_profile(
  p_full_name  text default null,
  p_full_name_ar text default null,
  p_phone      text default null,
  p_locale     text default null
)
returns public.profiles
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after  public.profiles;
  v_user   uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select to_jsonb(p) into v_before from public.profiles p where p.id = v_user;

  update public.profiles p
  set full_name    = coalesce(p_full_name,    p.full_name),
      full_name_ar = coalesce(p_full_name_ar, p.full_name_ar),
      phone        = coalesce(p_phone,        p.phone),
      locale       = coalesce(p_locale,       p.locale)
  where p.id = v_user
  returning * into v_after;

  perform private.write_audit(
    'profile.updated', 'profile', v_user::text, v_before, to_jsonb(v_after)
  );

  return v_after;
end;
$$;

-- ── last seen ───────────────────────────────────────────────────────────────
-- Written on every authenticated request by middleware. SECURITY DEFINER because
-- the client is not allowed to update someone else's last_seen_at, and because
-- this runs on a hot path where a failed update must never break the request.

create or replace function private.touch_last_seen()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles
  set last_seen_at = now()
  where id = (select auth.uid())
$$;

create or replace function api.touch()
returns void
language sql
security invoker
set search_path = ''
as $$ select private.touch_last_seen() $$;

-- ── grants on the api schema ────────────────────────────────────────────────
-- Default is EXECUTE for PUBLIC on new functions, which would let `anon` call
-- these too. Revoke, then grant only to authenticated.

revoke all on all functions in schema api from public;
grant execute on all functions in schema api to authenticated;

-- Future functions in this schema are not automatically callable. Explicit is
-- safer than inherited when the schema holds privileged operations.
alter default privileges in schema api
  revoke execute on functions from public;
alter default privileges in schema api
  grant execute on functions to authenticated;
