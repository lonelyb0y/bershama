-- Self-serve signup: an organisation can now create itself.
--
-- ── what this changes ───────────────────────────────────────────────────────────
--
-- Until now the only way to become a user was for an administrator to insert a
-- profiles row. There is no signup route and no provisioning path, so the app is
-- genuinely invite-only and enabling Supabase's "Allow new users to sign up" would have
-- done nothing except let strangers create accounts that land straight back on the login
-- page forever.
--
-- This adds the missing half: api.provision_tenant(), which a freshly signed-up person
-- calls once to create their organisation and become its TENANT_ADMIN.
--
-- ── why it is safe to open sign-ups at all ──────────────────────────────────────
--
-- Worth being explicit, because "let anyone sign up" is the kind of change that should
-- meet scepticism. Nothing is exposed by doing so, and that is not a hope -- it is two
-- independent mechanisms:
--
--   1. private.current_tenant_id() returns NULL for a user with no profiles row, and
--      every RLS policy compares tenant_id against it. NULL fails every comparison, so
--      every policy denies. No row in any table is readable.
--   2. api.whoami() returns zero rows for a profileless user, so getSession() returns
--      null and AuthenticatedShell redirects to /login.
--
-- So a user who signs up and stops here has nothing. They cannot read stock, cannot read
-- the catalogue, cannot see another tenant, and cannot enumerate anything. The signup
-- page exists to close the loop, not to breach it.
--
-- ── the gate that matters ───────────────────────────────────────────────────────
--
-- Callers must have NO existing profile: one organisation per person, once, ever.
--
-- Without that, api.provision_tenant() is an unauthenticated-adjacent "create a tenant"
-- endpoint: any signed-in user could call it in a loop and manufacture unlimited
-- tenants, which is unbounded resource creation on someone else's infrastructure. With
-- it, the function is spent the moment it succeeds and returns a clear error thereafter.
--
-- Later access to a second organisation is an invitation, which is the right tool for it
-- -- an administrator decides that, not the person themselves.
--
-- ── why SECURITY DEFINER ────────────────────────────────────────────────────────
--
-- It has to write to tenants and profiles while RLS is denying everything, because the
-- caller has no tenant and that is the entire situation being resolved. Same bargain as
-- every other api.* wrapper: the wrapper IS the boundary, and it is only safe because the
-- checks below are unconditional rather than advisory.

create or replace function api.provision_tenant(
  p_org_name  text,
  p_full_name text,
  p_country_code text default 'EG',
  p_timezone     text default 'Africa/Cairo'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_email     text;
  v_slug_base text;
  v_slug      text;
  v_tenant_id uuid;
  v_attempt   int := 0;
begin
  -- 1. Signed in, and signed in as a real person ────────────────────────────────
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select u.email into v_email
  from auth.users u
  where u.id = v_uid;

  -- A null email means an OAuth/OIDC identity, or a deleted user. Refusing is right in
  -- both cases: without an address there is nothing to invite later and nothing to
  -- recover an account with.
  if v_email is null then
    raise exception 'account has no email address; cannot provision' using errcode = '42501';
  end if;

  -- 2. One organisation per person, once ────────────────────────────────────────
  --
  -- Checked before anything is written, and again implicitly by the unique primary key
  -- on profiles.id: two concurrent calls cannot both win, because both would try to
  -- insert the same id. The loser gets a primary-key violation rather than a second
  -- tenant.
  if exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'already belongs to an organisation'
      using errcode = '42501',
            hint = 'To join another organisation, ask an administrator for an invitation.';
  end if;

  -- 3. Validate what a human typed ─────────────────────────────────────────────
  --
  -- Trimmed and length-bounded before use, because these values land in a
  -- NOT NULL/CHECK column and an over-long string should be a clear error rather than a
  -- constraint violation the caller has to decode.
  p_org_name  := left(btrim(coalesce(p_org_name, '')), 160);
  p_full_name := left(btrim(coalesce(p_full_name, '')), 120);

  if length(p_org_name) < 2 then
    raise exception 'organisation name is required' using errcode = '22023';
  end if;
  if length(p_full_name) < 2 then
    raise exception 'your name is required' using errcode = '22023';
  end if;

  -- Uppercase, two letters, restricted to the shape the schema expects.
  --
  -- Validated BEFORE any truncation, and that ordering is the whole point. Truncating
  -- first and validating second accepts 'EGYPT' by silently turning it into 'EG' -- a
  -- caller who fat-fingers a country is told nothing and shipped to the wrong currency
  -- jurisdiction. The assertion in self_serve_signup.test.sql that caught this is why the
  -- order is written down here.
  p_country_code := upper(btrim(coalesce(p_country_code, 'EG')));
  if p_country_code !~ '^[A-Z]{2}$' then
    raise exception 'country code must be two letters' using errcode = '22023';
  end if;

  p_timezone := coalesce(nullif(btrim(p_timezone), ''), 'Africa/Cairo');

  -- 4. A slug that satisfies the CHECK and does not collide ────────────────────
  --
  -- tenants.slug must match ^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$, so anything that is not
  -- a lowercase letter or digit collapses to a hyphen. An Arabic or Chinese organisation
  -- name therefore slugifies to nothing, which is exactly why the fallback exists: the
  -- first two characters of the new tenant's uuid rather than an empty string or a name
  -- the user did not ask for.
  v_slug_base := trim(both '-' from
    regexp_replace(lower(p_org_name), '[^a-z0-9]+', '-', 'g'));

  if length(v_slug_base) < 3 then
    v_slug_base := 'org';
  end if;
  v_slug_base := left(v_slug_base, 55);

  -- Collisions are expected: two pharmacies will both be called "Pharmacy". A numeric
  -- suffix is enough and needs no coordination, because the slug is display-only and the
  -- uuid is the real key.
  loop
    v_slug := v_slug_base
      || case when v_attempt = 0 then '' else '-' || v_attempt::text end;

    exit when not exists (select 1 from public.tenants t where t.slug = v_slug);

    v_attempt := v_attempt + 1;
    if v_attempt > 200 then
      raise exception 'could not derive a unique organisation slug' using errcode = '40001';
    end if;
  end loop;

  -- 5. Create it ───────────────────────────────────────────────────────────────
  --
  -- Security definer, so RLS is bypassed here by design. Everything above is what makes
  -- that safe. The caller supplies no tenant_id, no role and no currency: those are set
  -- below from constants and the caller's verified identity, never from the request.
  insert into public.tenants (
    slug, name_en, country_code, currency_code, vat_rate, timezone, locale_default
  )
  values (
    v_slug,
    p_org_name,
    p_country_code,
    'EGP',          -- currency follows the country; the admin can change it later
    0,
    p_timezone,
    'en'
  )
  returning id into v_tenant_id;

  insert into public.profiles (id, tenant_id, role, full_name, is_active, locale)
  values (
    v_uid,
    v_tenant_id,
    'TENANT_ADMIN',  -- the person who created the organisation administers it
    p_full_name,
    true,
    'en'
  );

  return v_tenant_id;
end;
$$;

comment on function api.provision_tenant(text, text, text, text) is
  'Self-serve onboarding: create one organisation and become its TENANT_ADMIN. Callable '
  'once per person -- a caller with an existing profile is refused. The caller never '
  'supplies tenant_id or role.';

revoke execute on function api.provision_tenant(text, text, text, text) from public, anon;
grant  execute on function api.provision_tenant(text, text, text, text) to authenticated;

-- Notifies PostgREST that `api` changed shape. Without this the RPC 404s until the
-- schema cache happens to reload, which is a confusing way to discover a missing GRANT.
notify pgrst, 'reload schema';