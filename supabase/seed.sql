-- ============================================================================
-- seed.sql
--
-- Development and demo data. Runs on every `supabase db reset`, so it must be
-- idempotent and must never be loaded into a production project.
--
-- SCOPE: identity only, matching milestone M0. Domain data (facilities, products,
-- batches, stock) arrives with M2, in the same migration that creates those
-- tables, so that a fresh `db reset` produces a coherent database rather than
-- seed rows pointing at tables that do not exist.
--
-- The demo accounts below exist ONLY in local development. They are created
-- here, never by a migration, so they cannot reach a hosted project.
--
-- Demo password for all three accounts: PharmaFlow#2026
-- ============================================================================

-- ── tenant ──────────────────────────────────────────────────────────────────
--
-- Tenant #1 is provisioned here rather than through a signup flow. There is no
-- public registration: onboarding is invite-only (see config.toml), which keeps
-- anonymous-signup abuse off the table entirely. Adding a second distributor
-- later is one more row and no schema change.
--
-- min_shelf_life_pct = 25 means FEFO will not allocate stock with less than a
-- quarter of its total shelf life remaining. Handing a pharmacy a box with three
-- weeks left is how the next complaint is generated.

insert into public.tenants (
  id, slug, name_en, name_ar, country_code, currency_code,
  vat_rate, timezone, locale_default, min_shelf_life_pct
)
values (
  '11111111-0000-4000-8000-000000000001',
  'demo-distribution',
  'Demo Distribution Co.',
  'شركة التوزيع التجريبية',
  'EG',
  'EGP',
  14.00,
  'Africa/Cairo',
  'ar',
  25.00
)
on conflict (id) do nothing;

-- ── users ───────────────────────────────────────────────────────────────────
--
-- Password hashes are generated here with crypt() so the demo works offline,
-- without a running Auth server. bcrypt, cost 10.

insert into auth.users (
  id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, aud, role
)
values
  (
    '11111111-0000-4000-8000-000000000101',
    'admin@demo.local',
    crypt('PharmaFlow#2026', gen_salt('bf', 10)),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, 'authenticated', 'authenticated'
  ),
  (
    '11111111-0000-4000-8000-000000000102',
    'pharmacy@demo.local',
    crypt('PharmaFlow#2026', gen_salt('bf', 10)),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, 'authenticated', 'authenticated'
  ),
  (
    '11111111-0000-4000-8000-000000000103',
    'driver@demo.local',
    crypt('PharmaFlow#2026', gen_salt('bf', 10)),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, 'authenticated', 'authenticated'
  )
on conflict (id) do nothing;

-- auth.identities is required for email/password sign-in to resolve a user.
-- Without these rows the account exists but signInWithPassword finds nothing.

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(),
  u.id,
  u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email),
  'email',
  now(), now(), now()
from auth.users u
where u.id in (
  '11111111-0000-4000-8000-000000000101',
  '11111111-0000-4000-8000-000000000102',
  '11111111-0000-4000-8000-000000000103'
)
on conflict do nothing;

-- ── profiles ────────────────────────────────────────────────────────────────
--
-- Roles live here, not in auth.users metadata. raw_user_meta_data is editable
-- by the user through the client, so a role read from there would be a
-- self-service privilege escalation.

insert into public.profiles (
  id, tenant_id, role, full_name, full_name_ar, phone, locale
)
values
  ('11111111-0000-4000-8000-000000000101', '11111111-0000-4000-8000-000000000001',
   'TENANT_ADMIN', 'Ahmed Hassan', 'أحمد حسن', '+201001234567', 'ar'),
  ('11111111-0000-4000-8000-000000000102', '11111111-0000-4000-8000-000000000001',
   'PHARMACY_MANAGER', 'Mariam Nabil', 'مريم نبيل', '+201112345678', 'ar'),
  ('11111111-0000-4000-8000-000000000103', '11111111-0000-4000-8000-000000000001',
   'DISTRIBUTOR', 'Mostafa Ali', 'مصطفى علي', '+201223456789', 'ar')
on conflict (id) do nothing;
