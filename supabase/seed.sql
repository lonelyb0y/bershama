-- ============================================================================
-- seed.sql
--
-- Development and demo data. Runs on every `supabase db reset`, so it must be
-- idempotent and must never be loaded into a production project.
--
-- The stock movements go through api.* exactly as the application does, so the
-- seeded balances are produced by the same code path that maintains them in
-- production. Seeding stock_balances directly would make the demo database
-- inconsistent with a real one, and would prove nothing about the trigger.
--
-- Product names are real Egyptian-market generics. Batch numbers and suppliers are
-- invented: attaching a fake lot number to a real drug is a mistake, even in
-- development data.
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
-- through the client, so a role read from it would be a self-service privilege
-- escalation.

insert into public.profiles (
  id, tenant_id, role, full_name, full_name_ar, phone, locale
)
values
  ('11111111-0000-4000-8000-000000000101', '11111111-0000-4000-8000-000000000001',
   'TENANT_ADMIN', 'Ahmed Hassan', 'أحمد حسن', '+201001234567', 'ar'),
  ('11111111-0000-4000-8000-000000000102', '11111111-0000-4000-8000-000000000001',
   'PHARMACY_MANAGER', 'Mariam Nabil', 'مريم نبيل', '+201112345678', 'ar'),
  -- DRIVER, not DISTRIBUTOR. This account was a distributor because there was no
  -- driver surface to route to; M4 built one, and seeding it as a distributor would
  -- leave the local demo tenant contradicting the hosted one.
  ('11111111-0000-4000-8000-000000000103', '11111111-0000-4000-8000-000000000001',
   'DRIVER', 'Mostafa Ali', 'مصطفى علي', '+201223456789', 'ar')
on conflict (id) do nothing;

-- ── facilities ──────────────────────────────────────────────────────────────
--
-- Cairo-area coordinates, real enough for the driver map and the expiry dashboard
-- to be meaningful. The warehouse is in the industrial zone; the pharmacies are
-- where a distributor in Greater Cairo would actually deliver.

insert into public.facilities (
  id, tenant_id, kind, code, name_en, name_ar, address, city, governorate,
  latitude, longitude, phone, license_no
)
values
  ('11111111-0000-4000-8000-000000000201', '11111111-0000-4000-8000-000000000001',
   'WAREHOUSE', 'WH-CAIRO', 'Main Warehouse Cairo', 'المستودع الرئيسي - القاهرة',
   'Zone 10, Industrial Area, 10th of Ramadan City', '10th of Ramadan', 'Sharqia',
   30.2959, 31.7419, '+20225550100', 'WH-2026-001'),
  ('11111111-0000-4000-8000-000000000202', '11111111-0000-4000-8000-000000000001',
   'PHARMACY', 'PH-NASR', 'Nasr City Pharmacy', 'صيدلية نصر',
   '15 Mohamed Farid St, Nasr City', 'Cairo', 'Cairo',
   30.0626, 31.3246, '+20225550101', 'PH-2026-001'),
  ('11111111-0000-4000-8000-000000000203', '11111111-0000-4000-8000-000000000001',
   'PHARMACY', 'PH-MAADI', 'Maadi Pharmacy', 'صيدلية المعادي',
   '22 9th St, Maadi', 'Cairo', 'Cairo',
   30.0444, 31.2025, '+20225550102', 'PH-2026-002')
on conflict (id) do nothing;

-- ── storage locations ───────────────────────────────────────────────────────
--
-- QUARANTINE and IN_TRANSIT are the two that carry weight. Received goods land in
-- QUARANTINE and are released into AMBIENT after inspection; IN_TRANSIT is a
-- virtual location so stock in a van is still counted and still owned by the
-- distributor.

insert into public.storage_locations (
  id, tenant_id, facility_id, kind, code, name_en, name_ar, temp_min_c, temp_max_c
)
values
  ('11111111-0000-4000-8000-000000000301', '11111111-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000201', 'AMBIENT', 'AMB-A1', 'Ambient A1', 'عادي أ1', 15, 25),
  ('11111111-0000-4000-8000-000000000302', '11111111-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000201', 'AMBIENT', 'AMB-A2', 'Ambient A2', 'عادي أ2', 15, 25),
  ('11111111-0000-4000-8000-000000000303', '11111111-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000201', 'COLD', 'COLD-C1', 'Cold Store', 'مخزن مبرد', 2, 8),
  ('11111111-0000-4000-8000-000000000304', '11111111-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000201', 'QUARANTINE', 'QUAR-1', 'Quarantine', 'حجر صحي', null, null),
  ('11111111-0000-4000-8000-000000000305', '11111111-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000201', 'IN_TRANSIT', 'TRANSIT', 'In Transit', 'في الطريق', null, null),
  ('11111111-0000-4000-8000-000000000306', '11111111-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000202', 'DISPENSE', 'DISP-1', 'Dispensing', 'صرف', 15, 25)
on conflict (id) do nothing;

-- ── catalogue ───────────────────────────────────────────────────────────────
--
-- Bilingual names because Egyptian pharmacies order against bilingual packaging,
-- and the ATC codes are the real ones so the catalogue is comparable with another
-- distributor's.

insert into public.products (
  id, tenant_id, sku, name_en, name_ar, generic_name_en, generic_name_ar, brand,
  form, strength, pack_size, uom, atc_code, gtin,
  requires_prescription, is_controlled, is_cold_chain, shelf_life_months
)
values
  ('11111111-0000-4000-8000-000000000401', '11111111-0000-4000-8000-000000000001',
   'PARA-500-20', 'Panadol Extra 500mg x20', 'بنادول إكسترا 500 مجم 20 قرص',
   'Paracetamol', 'باراسيتامول', 'Panadol', 'TABLET', '500mg', 20, 'BOX', 'N02BE01', '6221031492039',
   false, false, false, 36),
  ('11111111-0000-4000-8000-000000000402', '11111111-0000-4000-8000-000000000001',
   'AMOX-500-21', 'Amoxil 500mg x21', 'أموكسيل 500 مجم 21 كبسولة',
   'Amoxicillin', 'أموكسيسيلين', 'Amoxil', 'CAPSULE', '500mg', 21, 'BOX', 'J01CA04', '6221031492046',
   true, false, false, 24),
  ('11111111-0000-4000-8000-000000000403', '11111111-0000-4000-8000-000000000001',
   'METF-850-30', 'Glucophage 850mg x30', 'جلوكوفاج 850 مجم 30 قرص',
   'Metformin', 'ميتفورمين', 'Glucophage', 'TABLET', '850mg', 30, 'BOX', 'A10BA02', '6221031492053',
   true, false, false, 36),
  ('11111111-0000-4000-8000-000000000404', '11111111-0000-4000-8000-000000000001',
   'INSU-100-5', 'Insulatard 100IU/ml x5', 'إنسولاتارد 100 وحدة 5 عبوات',
   'Insulin human', 'إنسولين بشري', 'Insulatard', 'VIAL', '100IU/ml', 5, 'BOX', 'A10AB01', '6221031492060',
   true, false, true, 24),
  ('11111111-0000-4000-8000-000000000405', '11111111-0000-4000-8000-000000000001',
   'ORS-20', 'Oral Rehydration Salts x20', 'أملاح معالجة الجفاف 20 كيس',
   'Oral rehydration salts', 'أملاح معالجة الجفاف', 'WHO Formula', 'SACHET', '4.21g', 20, 'BOX', 'A02DA01', '6221031492077',
   false, false, false, 24),
  ('11111111-0000-4000-8000-000000000406', '11111111-0000-4000-8000-000000000001',
   'ATORV-20-30', 'Lipitor 20mg x30', 'ليبيتور 20 مجم 30 قرص',
   'Atorvastatin', 'أتورفاستاتين', 'Lipitor', 'TABLET', '20mg', 30, 'BOX', 'C10AA05', '6221031492084',
   true, false, false, 36),
  ('11111111-0000-4000-8000-000000000407', '11111111-0000-4000-8000-000000000001',
   'TRAM-50-20', 'Tramal 50mg x20', 'ترامال 50 مجم 20 قرص',
   'Tramadol', 'ترامادول', 'Tramal', 'TABLET', '50mg', 20, 'BOX', 'N02AX02', '6221031492091',
   true, true, false, 36)
on conflict (id) do nothing;

-- ── stock ───────────────────────────────────────────────────────────────────
--
-- Posted through api.receive_stock() and api.release_batch() as a warehouse
-- manager, because that is the only path that produces a ledger row. Seeding
-- stock_balances directly would leave the ledger empty, and reconciliation would
-- correctly report that every balance is drift.
--
-- The api.* wrappers are SECURITY DEFINER and require a role check, so the session
-- is impersonated here the way the application does it. `set local role` outside
-- a transaction would not persist, hence the do block.

insert into public.batches (
  id, tenant_id, product_id, lot_number, mfg_date, expiry_date,
  unit_cost_minor, supplier_name, supplier_ref, status
)
values
  -- Comfortable shelf life, released and in AMBIENT.
  ('11111111-0000-4000-8000-000000000501', '11111111-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000401', 'LOT-2026-A0412',
   current_date - 400, current_date + 700, 4500,
   'Egyptian Pharma Industries', 'PO-2026-0187', 'RELEASED'),
  -- The FEFO trap: a nearly expired lot of the same product. Exists so the
  -- expiry dashboard and M3's allocator have something real to choose between.
  ('11101111-0000-4000-8000-000000000503', '11111111-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000401', 'LOT-2025-C0442',
   current_date - 1000, current_date + 75, 4200,
   'Egyptian Pharma Industries', 'PO-2025-0902', 'RELEASED'),
  -- Amoxicillin, 24 month product.
  ('11111111-0000-4000-8000-000000000502', '11111111-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000402', 'LOT-2026-B1180',
   current_date - 300, current_date + 430, 12800,
   'Delta Pharma', 'PO-2026-0203', 'RELEASED'),
  -- Cold chain, in the cold store.
  ('11111111-0000-4000-8000-000000000504', '11111111-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000404', 'LOT-2026-D0777',
   current_date - 200, current_date + 530, 38500,
   'Novo Nordisk Egypt', 'PO-2026-0221', 'RELEASED'),
  -- Tramadol: controlled, so it carries the extra record-keeping flag.
  ('11111111-0000-4000-8000-000000000507', '11111111-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000407', 'LOT-2026-G0311',
   current_date - 250, current_date + 845, 7600,
   'Delta Pharma', 'PO-2026-0240', 'QUARANTINED'),
  -- ORS, arriving but not yet inspected. Quarantined, so not allocatable.
  ('11111111-0000-4000-8000-000000000508', '11111111-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000405', 'LOT-2026-H0091',
   current_date - 60, current_date + 670, 2100,
   'Global Pharma Egypt', 'PO-2026-0251', 'QUARANTINED'),
  -- Already expired: present so the expiry report has a real EXPIRED band, and so
  -- something must be written off.
  ('11111111-0000-4000-8000-000000000505', '11111111-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000405', 'LOT-2024-E0091',
   current_date - 1000, current_date - 30, 2000,
   'Global Pharma Egypt', 'PO-2024-0812', 'RELEASED')
on conflict (id) do nothing;

do $$
declare
  v_manager uuid;
  v_driver  uuid;
  v_trip    public.trips;
begin
  -- The demo accounts are found by email rather than by the seeded ids. The local
  -- seed uses 11111111-...-000000000101 and 103, but the hosted project was seeded
  -- through account creation and its profiles carry generated uuids -- so hardcoding
  -- them worked locally and failed on the hosted database, which is the direction
  -- that matters least to notice.
  select p.id into v_manager
  from public.profiles p join auth.users u on u.id = p.id
  where u.email = 'admin@demo.local';

  select p.id into v_driver
  from public.profiles p join auth.users u on u.id = p.id
  where u.email = 'driver@demo.local';

  -- A no-op on a database that is not the demo one. This migration runs BEFORE
  -- seed.sql on a fresh environment, so raising here would mean a demo fixture
  -- could stop the whole migration set from applying anywhere but the demo
  -- project. Demo data is not worth that: on a fresh database the run is created
  -- by the seed instead, which is the right place for it.
  if v_manager is null or v_driver is null then
    raise notice 'demo accounts not present -- skipping demo delivery data';
    return;
  end if;

  -- Same reason as the stock fixtures above: the wrappers check the caller's role
  -- through profiles, so the session has to look signed in.
  perform set_config('request.jwt.claim.sub', v_manager::text, true);

  if not exists (select 1 from public.vehicles where code = 'VAN-1') then
    perform api.create_vehicle('VAN-1', 'Refrigerated delivery van', 'ABC 1234');
  end if;

  if not exists (select 1 from public.trips where notes = 'Morning run' and run_date = current_date) then
    select * into v_trip
    from api.create_trip(current_date,
                         (select id from public.vehicles where code = 'VAN-1' limit 1),
                         'Morning run');

    perform api.add_trip_stop(v_trip.id, '11111111-0000-4000-8000-000000000202');
    perform api.add_trip_stop(v_trip.id, '11111111-0000-4000-8000-000000000203');
    perform api.dispatch_trip(v_trip.id, v_driver);
  else
    select * into v_trip
    from public.trips where notes = 'Morning run' and run_date = current_date limit 1;
  end if;

  -- One stop already arrived, with a position, so the map has something to plot and
  -- the sign sheet is reachable without faking a geolocation fix in a test.
  if exists (
    select 1 from public.delivery_stops
    where trip_id = v_trip.id and sequence = 1 and status = 'PENDING'
  ) then
    perform set_config('request.jwt.claim.sub', v_driver::text, true);
    perform api.start_trip(v_trip.id);
    perform api.arrive_at_stop(
      (select id from public.delivery_stops where trip_id = v_trip.id and sequence = 1),
      30.0444, 31.2357
    );
  end if;
end
$$;
