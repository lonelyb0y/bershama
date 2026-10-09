-- ============================================================================
-- cold_chain_readings.test.sql
--
-- A temperature log is evidence, so the failures that matter are not "the number is
-- wrong". They are:
--
--   * someone filing away an excursion by declaring it in-spec;
--   * a range being edited afterwards and retroactively turning a fault into a non-fault;
--   * a reading recorded against a shelf, which is noise every future query must filter;
--   * a reading with no declared range being recorded as *passing* rather than as unknown;
--   * the log being editable at all.
--
-- That last one is why there is no update policy and no writer that takes a reading id.
-- ============================================================================

begin;

select plan(15);

insert into auth.users (id, email, email_confirmed_at)
values ('77777777-0000-4000-8000-000000000001', 'cold-admin@signup.test', now()),
       ('77777777-0000-4000-8000-000000000002', 'other-cold@signup.test', now());

insert into public.tenants (id, slug, name_en, country_code, currency_code)
values ('88888888-0000-4000-8000-000000000001', 'cold-test-co', 'Cold Test Co', 'EG', 'EGP')
on conflict (id) do nothing;

insert into public.profiles (id, tenant_id, role, full_name, is_active, locale)
values
  ('77777777-0000-4000-8000-000000000001', '88888888-0000-4000-8000-000000000001',
   'PHARMACY_MANAGER', 'Cold Manager', true, 'en'),
  ('77777777-0000-4000-8000-000000000002', '88888888-0000-4000-8000-000000000001',
   'DRIVER', 'Cold Driver', true, 'en')
on conflict (id) do nothing;

insert into public.facilities (id, tenant_id, code, name_en, name_ar, kind)
values ('99999999-0000-4000-8000-000000000001', '88888888-0000-4000-8000-000000000001',
        'CPH', 'Cold Pharmacy', 'صيدلية باردة', 'PHARMACY')
on conflict (id) do nothing;

-- Three locations, because the three cases need three locations: a rated fridge, a fridge
-- nobody has specified, and a shelf.
insert into public.storage_locations
  (id, tenant_id, facility_id, kind, code, name_en, name_ar, temp_min_c, temp_max_c)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '88888888-0000-4000-8000-000000000001',
   '99999999-0000-4000-8000-000000000001', 'COLD', 'FR-1', 'Fridge 1', 'ثلاجة ١',
   2.00, 8.00),
  ('aaaaaaaa-0000-4000-8000-000000000002', '88888888-0000-4000-8000-000000000001',
   '99999999-0000-4000-8000-000000000001', 'FREEZER', 'FZ-1', 'Freezer 1', 'فريزر ١',
   -25.00, -15.00),
  ('aaaaaaaa-0000-4000-8000-000000000003', '88888888-0000-4000-8000-000000000001',
   '99999999-0000-4000-8000-000000000001', 'AMBIENT', 'SH-1', 'Shelf 1', 'رف ١',
   null, null)
on conflict (id) do nothing;

set local request.jwt.claim.sub = '77777777-0000-4000-8000-000000000001';

-- ── 1. the happy path, and the verdict ─────────────────────────────────────────────

select ok(
  api.record_cold_reading('aaaaaaaa-0000-4000-8000-000000000001', 5.0) is not null,
  'an in-range reading is recorded'
);

-- Selected by temperature rather than by recency: `now()` is transaction-constant, so
-- both readings in this transaction share a read_at and "the most recent one" is ambiguous
-- between them. Ordering by a column that is identical cannot distinguish two rows, and the
-- assertion silently checks whichever the planner returns first.
select is(
  (select is_excursion from public.cold_chain_readings
    where location_id = 'aaaaaaaa-0000-4000-8000-000000000001' and temp_c = 5.0),
  false,
  '5C in a 2-8C fridge is not an excursion'
);

select is(
  (select excursion_c from public.cold_chain_readings
    where location_id = 'aaaaaaaa-0000-4000-8000-000000000001' and temp_c = 5.0),
  0::numeric,
  'and it records zero, not null, because in-range is a real answer'
);

-- ── 2. an excursion, and how far ───────────────────────────────────────────────────

select ok(
  api.record_cold_reading('aaaaaaaa-0000-4000-8000-000000000001', 11.0) is not null,
  'an out-of-range reading is still recorded -- that is the reading you most need'
);

select is(
  (select is_excursion from public.cold_chain_readings
    where location_id = 'aaaaaaaa-0000-4000-8000-000000000001' and temp_c = 11.0),
  true,
  'and it is marked as an excursion'
);

-- The number a pharmacist actually needs: not "it was bad" but "how bad".
select is(
  (select excursion_c from public.cold_chain_readings
    where location_id = 'aaaaaaaa-0000-4000-8000-000000000001' and temp_c = 11.0),
  3.00::numeric,
  'the excursion is quantified in degrees, so a 3C overshoot is distinguishable from a 10C one'
);

-- ── 3. the verdict is taken once, and does not change afterwards ───────────────────

-- Re-rating the fridge afterwards must not rewrite what the reading said at the time. This
-- is the reason range_min_c/range_max_c are denormalised onto the row.
update public.storage_locations
   set temp_min_c = 2.00, temp_max_c = 15.00
 where id = 'aaaaaaaa-0000-4000-8000-000000000001';

select is(
  (select is_excursion from public.cold_chain_readings
    where location_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and temp_c = 11.0),
  true,
  'widening the range afterwards does not retroactively excuse the excursion'
);

select is(
  (select range_max_c from public.cold_chain_readings
    where location_id = 'aaaaaaaa-0000-4000-8000-000000000001' and temp_c = 11.0),
  8.00::numeric,
  'and the reading keeps the range it was judged against'
);

-- Put it back for the remaining assertions.
update public.storage_locations
   set temp_max_c = 8.00
 where id = 'aaaaaaaa-0000-4000-8000-000000000001';

-- ── 4. no declared range is unknown, not "in spec" ─────────────────────────────────

select ok(
  api.record_cold_reading('aaaaaaaa-0000-4000-8000-000000000002', -20.0) is not null,
  'a freezer reading within -25..-15 is recorded'
);

-- A location with no range: the verdict must be NULL, not false.
insert into public.storage_locations
  (id, tenant_id, facility_id, kind, code, name_en, name_ar, temp_min_c, temp_max_c)
values ('aaaaaaaa-0000-4000-8000-000000000004', '88888888-0000-4000-8000-000000000001',
        '99999999-0000-4000-8000-000000000001', 'COLD', 'FR-2', 'Unrated Fridge', 'ثلاجة ٢',
        null, null)
on conflict (id) do nothing;

select ok(
  api.record_cold_reading('aaaaaaaa-0000-4000-8000-000000000004', 5.0) is not null,
  'a reading against a fridge with no declared range is still accepted'
);

-- ok(... is null) rather than a dedicated is_null(): this project's pgtap shim has no
-- such assertion, and adding one for a single call site would be more machinery than the
-- check is worth.
select ok(
  (select is_excursion from public.cold_chain_readings
    where location_id = 'aaaaaaaa-0000-4000-8000-000000000004') is null,
  'but its verdict is unknown, not false: nobody declared a spec to pass'
);

-- ── 5. refusals ────────────────────────────────────────────────────────────────────

select throws_ok(
  $$select api.record_cold_reading('aaaaaaaa-0000-4000-8000-000000000003', 20.0)$$,
  '22023', 'readings are only accepted for COLD or FREEZER locations',
  'a reading against an ambient shelf is refused rather than filed as noise'
);

select throws_ok(
  $$select api.record_cold_reading('aaaaaaaa-0000-4000-8000-000000000001', 200.0)$$,
  '22023', 'temperature out of range',
  'a temperature outside the range of the physical world is refused'
);

select throws_ok(
  $$select api.record_cold_reading('aaaaaaaa-0000-4000-8000-000000000001', 5.0,
                                   now() + interval '2 days')$$,
  '22023', 'read_at is in the future',
  'a future-dated reading is refused: it is a mistake, not a forecast'
);

-- ── 6. a driver may not attest to a temperature ────────────────────────────────────
--
-- Asserted as a refusal from the function rather than as the absence of an RLS write policy.
-- Both matter, and they are different guarantees: the policy stops a direct insert, this
-- stops a driver through the supported path. A test on the policy alone would still pass if
-- the role check inside the function were removed.

set local request.jwt.claim.sub = '77777777-0000-4000-8000-000000000002';

select throws_ok(
  $$select api.record_cold_reading('aaaaaaaa-0000-4000-8000-000000000001', 5.0)$$,
  '42501', null,
  'a driver cannot record a temperature'
);

select * from finish();
rollback;