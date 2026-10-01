-- The catalogue's write path, actually called.
--
-- ── the bug this file exists for ────────────────────────────────────────────
--
-- `api.create_product` and `api.update_product` were rewritten by 0058 to carry the
-- sell price, and in the rewrite they lost the cast on `strength_unit`. Postgres
-- implicitly casts a *literal* to an enum but not an *expression*, so every product
-- create and edit returned:
--
--   column "strength_unit" is of type private.strength_unit
--   but expression is of type text
--
-- That is a Postgres type error, not a policy error, so it did not surface as a
-- permission failure -- which is what every other suite here watches for, and why
-- they all stayed green. 0058's own comment names both functions; nothing in the
-- database suites *calls* them. The Playwright spec that fills in the product form
-- and waits for the SKU to appear is what found it, and that spec is not in CI.
--
-- So: call them. An unreferenced function body can be wrong for months, because
-- reading it tells you nothing about whether Postgres will run it.
--
-- ── why `set role` matters here too ──────────────────────────────────────────
--
-- These functions are SECURITY DEFINER, so they run as their owner. The test still
-- switches to `authenticated`, because that is the only way to be sure the *grant*
-- reaches the caller -- and a function whose body is correct but ungranted is the
-- same outage from the client's point of view.

begin;

select plan(10);

insert into public.tenants (id, slug, name_en, currency_code, vat_rate, timezone)
values ('55555555-0000-4000-8000-000000000001', 'catalogue-test', 'Catalogue Test Co', 'EGP', 0.14, 'Africa/Cairo');

insert into auth.users (id, email, aud, role)
values ('55555555-0000-4000-8000-000000000001', 'catalogue@catalogue-test.local', 'authenticated', 'authenticated');

insert into public.profiles (id, tenant_id, full_name, role, is_active)
values ('55555555-0000-4000-8000-000000000001', '55555555-0000-4000-8000-000000000001', 'Cataloguer', 'WAREHOUSE_MANAGER', true);

set local request.jwt.claim.sub = '55555555-0000-4000-8000-000000000001';

set role authenticated;

-- ── the create ───────────────────────────────────────────────────────────────
--
-- `strength_unit` is passed as text, exactly as the form sends it. If the function
-- ever drops the cast again this fails here rather than in a browser.

select lives_ok(
  $$
  select api.create_product(
    p_sku              => 'CAT-1',
    p_name_en          => 'Catalogue One',
    p_name_ar          => 'الكتالوج واحد',
    p_form             => 'TABLET',
    p_strength         => '500',
    p_strength_unit    => 'mg',
    p_pack_size        => 20,
    p_uom              => 'BOX',
    p_shelf_life_months => 24,
    p_sell_price_minor => 12500
  )
  $$,
  'api.create_product runs with a strength_unit in text'
);

select is(
  (select strength_unit::text from public.products where sku = 'CAT-1'),
  'mg',
  'the strength unit was cast to the enum and stored'
);

select is(
  (select sell_price_minor from public.products where sku = 'CAT-1'),
  12500::bigint,
  'the sell price came through, so the rewrite in 0058 is still intact'
);

-- A strength with no *unit* is legal, and it is the case that matters: the cast has
-- to survive a null on its way to the enum. (A strength with no number is not --
-- products.strength is not null, so that form cannot be saved at all.)
select lives_ok(
  $$
  select api.create_product(
    p_sku       => 'CAT-2',
    p_name_en   => 'Catalogue Two',
    p_name_ar   => 'الكتالوج اثنان',
    p_form      => 'VIAL',
    p_strength  => '250',
    p_pack_size => 5,
    p_uom       => 'VIAL'
  )
  $$,
  'api.create_product runs with a strength and no strength unit'
);

select is(
  (select strength_unit from public.products where sku = 'CAT-2'),
  null,
  'a missing strength unit stays null rather than becoming an empty enum'
);

-- A comment about strength: not every product is dosed, and a form that always sent
-- a unit would put "MG" on a unit-less line. The null has to survive the cast.

-- ── the update ───────────────────────────────────────────────────────────────

-- api.update_product is a full replace, not a patch: sku, name_en and name_ar have no
-- defaults and the function writes every column unconditionally. So a caller always
-- posts the whole form. Passing only the changed field nulls the rest -- which is why
-- the form posts everything, and why this test has to as well.

select lives_ok(
  $$
  select api.update_product(
    p_id            => (select id from public.products where sku = 'CAT-1'),
    p_sku           => 'CAT-1',
    p_name_en       => 'Catalogue One',
    p_name_ar       => 'الكتالوج واحد',
    p_strength      => '500',
    p_strength_unit => 'mcg'
  )
  $$,
  'api.update_product can change the strength unit'
);

select is(
  (select strength_unit::text from public.products where sku = 'CAT-1'),
  'mcg',
  'the updated strength unit was cast and stored'
);

-- ── a bad value is still rejected ────────────────────────────────────────────
--
-- The cast must not become a way through: 'furlongs' is not a member of the enum,
-- so it has to fail. A missing cast would make this assertion fail, which is the
-- other half of what the cast is for.

-- The sqlstate, not the wording.
--
-- The two engines report the message differently -- the compatibility shim catches
-- `invalid input value for enum private.strength_unit: "furlongs"` while real pgTAP
-- prefixes the state as `22P02: ...` -- and they match it differently too, LIKE
-- against a regex. Any single expected string passes on one engine and fails on the
-- other. 22P02 is `invalid_text_representation`, which is the actual contract here;
-- the wording is Postgres's to change.
select throws_ok(
  $$
  select api.create_product(
    p_sku           => 'CAT-3',
    p_name_en       => 'Catalogue Three',
    p_name_ar       => 'الكتالوج ثلاثة',
    p_form          => 'TABLET',
    p_strength_unit => 'furlongs',
    p_pack_size     => 10,
    p_uom           => 'BOX'
  )
  $$,
  '22P02',
  null,
  'a strength unit outside the enum is refused'
);

-- ── and the sell price is optional on update ─────────────────────────────────
--
-- p_sell_price_minor null has to mean "leave the price alone", not "clear it" --
-- otherwise editing a product's name silently wipes its price.

select lives_ok(
  $$
  select api.update_product(
    p_id       => (select id from public.products where sku = 'CAT-1'),
    p_sku      => 'CAT-1',
    p_name_en  => 'Catalogue One Renamed',
    p_name_ar  => 'الكتالوج واحد',
    p_strength => '500',
    p_strength_unit => 'mcg'
  )
  $$,
  'api.update_product leaves the price alone when the price is not supplied'
);

select is(
  (select sell_price_minor from public.products where sku = 'CAT-1'),
  12500::bigint,
  'the sell price survived an unrelated edit'
);

reset role;

select * from finish();
rollback;
