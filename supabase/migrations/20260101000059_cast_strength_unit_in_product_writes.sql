-- 0059: two defects in the catalogue's write path, both found by calling it
--
-- ── 1. the missing strength_unit cast ──────────────────────────────────────────
--
-- These two functions were rewritten by 0058 to carry the sell price, and in the
-- rewrite they lost the cast on `strength_unit`. The neighbouring columns kept
-- theirs -- `form` is cast `::private.product_form` and `uom` is cast
-- `::private.stock_unit` on the very same line -- so the omission reads as an
-- accident rather than a decision, which is what it was.
--
-- The failure is Postgres refusing a type, not raising a policy error:
--
--   column "strength_unit" is of type private.strength_unit
--   but expression is of type text
--
-- Postgres implicitly casts a *literal* to an enum. It does not cast an
-- *expression*, and `nullif(btrim(coalesce(...)), '')` is an expression.
--
-- The parameter stays `text`. The cast belongs inside the function body, where it
-- runs as the owner, for the reason set out at length in rls_coverage.test.sql:
-- typing the parameter as the enum would put a private type in the client-facing
-- signature. A bad value is still rejected -- a cast to an enum rejects anything
-- that is not a member -- so no validation is given up.
--
-- ── 2. the UNSPECIFIED form that was never a member ───────────────────────────
--
-- Both functions fall back to a placeholder when the caller sends no form:
--
--   form = coalesce(nullif(btrim(coalesce(p_form, '')), ''), 'UNSPECIFIED')::private.product_form
--
-- `products.form` is not null, so a fallback is needed -- but `UNSPECIFIED` is not
-- and never was a member of `private.product_form`. Postgres does not complain when
-- the function is *created*, because the literal is `unknown` until it runs, so the
-- error only appears on the first call that omits a form:
--
--   invalid input value for enum private.product_form: "UNSPECIFIED"
--
-- So the placeholder was never reachable, and any caller that left the form blank
-- got an enum error rather than a stored product. The value is added here rather
-- than substituted into an existing member, because "not specified" is what the
-- code means and quietly storing, say, 'TABLET' would put a claim in the data that
-- nobody made.
--
-- ALTER TYPE ... ADD VALUE cannot be *used* in the transaction that adds it, so the
-- order below matters: the type is widened first and the functions that mention it
-- are (re)defined after. Nothing here executes the functions, so the pair is safe.
--
-- The parameter list, the grants and the revokes are unchanged from 0058 apart from
-- the two casts, so the generated types do not move.
--
-- ── what would have caught this ───────────────────────────────────────────────
--
-- No pgTAP suite called either function. 0058's own comment names them, but nothing
-- inserted a product through them, so a body that could not execute was green for
-- the whole life of the migration. The Playwright spec that fills in the product
-- form and waits for the SKU to appear is what found it -- and that spec does not
-- run in CI. `catalogue_writes.test.sql` now calls both, asserts the values land,
-- and asserts that a strength unit outside the enum is still refused.
--
-- `p_uom` has the same shape and is fine: 'BOX' *is* a member of
-- `private.stock_unit`.

alter type private.product_form add value if not exists 'UNSPECIFIED';

create or replace function api.create_product(
  p_sku text,
  p_name_en text,
  p_name_ar text,
  p_generic_name_en text default null,
  p_generic_name_ar text default null,
  p_brand text default null,
  p_form text default null,
  p_strength text default null,
  p_strength_unit text default null,
  p_pack_size integer default null,
  p_uom text default null,
  p_atc_code text default null,
  p_gtin text default null,
  p_eda_reg_no text default null,
  p_requires_prescription boolean default false,
  p_is_controlled boolean default false,
  p_is_cold_chain boolean default false,
  p_shelf_life_months integer default null,
  p_sell_price_minor bigint default 0
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select private.current_tenant_id());
  v_row    public.products;
begin
  if v_tenant is null then
    raise exception 'no tenant for the current session' using errcode = '42501';
  end if;

  if not (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER')) then
    raise exception 'only a warehouse manager may add a product' using errcode = '42501';
  end if;

  insert into public.products (
    tenant_id, sku, name_en, name_ar, generic_name_en, generic_name_ar, brand, form,
    strength, strength_unit, pack_size, uom, atc_code, gtin, eda_reg_no,
    requires_prescription, is_controlled, is_cold_chain, shelf_life_months,
    sell_price_minor
  )
  values (
    v_tenant, btrim(p_sku), btrim(p_name_en), btrim(p_name_ar),
    nullif(btrim(coalesce(p_generic_name_en, '')), ''),
    nullif(btrim(coalesce(p_generic_name_ar, '')), ''),
    nullif(btrim(coalesce(p_brand, '')), ''),
    coalesce(nullif(btrim(coalesce(p_form, '')), ''), 'UNSPECIFIED')::private.product_form,
    nullif(btrim(coalesce(p_strength, '')), ''),
    nullif(btrim(coalesce(p_strength_unit, '')), '')::private.strength_unit,
    coalesce(p_pack_size, 1),
    coalesce(nullif(btrim(coalesce(p_uom, '')), ''), 'BOX')::private.stock_unit,
    nullif(upper(btrim(coalesce(p_atc_code, ''))), ''),
    nullif(btrim(coalesce(p_gtin, '')), ''),
    nullif(btrim(coalesce(p_eda_reg_no, '')), ''),
    coalesce(p_requires_prescription, false),
    coalesce(p_is_controlled, false),
    coalesce(p_is_cold_chain, false),
    coalesce(p_shelf_life_months, 1),
    coalesce(p_sell_price_minor, 0)
  )
  returning * into v_row;

  return v_row;
end
$$;

create or replace function api.update_product(
  p_id uuid,
  p_sku text,
  p_name_en text,
  p_name_ar text,
  p_generic_name_en text default null,
  p_generic_name_ar text default null,
  p_brand text default null,
  p_form text default null,
  p_strength text default null,
  p_strength_unit text default null,
  p_pack_size integer default null,
  p_uom text default null,
  p_atc_code text default null,
  p_gtin text default null,
  p_eda_reg_no text default null,
  p_requires_prescription boolean default false,
  p_is_controlled boolean default false,
  p_is_cold_chain boolean default false,
  p_shelf_life_months integer default null,
  p_is_active boolean default null,
  p_sell_price_minor bigint default null
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select private.current_tenant_id());
  v_row    public.products;
begin
  if v_tenant is null then
    raise exception 'no tenant for the current session' using errcode = '42501';
  end if;

  if not (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER')) then
    raise exception 'only a warehouse manager may edit a product' using errcode = '42501';
  end if;

  update public.products p
  set sku = btrim(p_sku),
      name_en = btrim(p_name_en),
      name_ar = btrim(p_name_ar),
      generic_name_en = nullif(btrim(coalesce(p_generic_name_en, '')), ''),
      generic_name_ar = nullif(btrim(coalesce(p_generic_name_ar, '')), ''),
      brand = nullif(btrim(coalesce(p_brand, '')), ''),
      form = coalesce(nullif(btrim(coalesce(p_form, '')), ''), 'UNSPECIFIED')::private.product_form,
      strength = nullif(btrim(coalesce(p_strength, '')), ''),
      strength_unit = nullif(btrim(coalesce(p_strength_unit, '')), '')::private.strength_unit,
      pack_size = coalesce(p_pack_size, 1),
      uom = coalesce(nullif(btrim(coalesce(p_uom, '')), ''), 'BOX')::private.stock_unit,
      atc_code = nullif(upper(btrim(coalesce(p_atc_code, ''))), ''),
      gtin = nullif(btrim(coalesce(p_gtin, '')), ''),
      eda_reg_no = nullif(btrim(coalesce(p_eda_reg_no, '')), ''),
      requires_prescription = coalesce(p_requires_prescription, false),
      is_controlled = coalesce(p_is_controlled, false),
      is_cold_chain = coalesce(p_is_cold_chain, false),
      shelf_life_months = coalesce(p_shelf_life_months, 1),
      is_active = coalesce(p_is_active, p.is_active),
      -- null means leave it alone, so a caller that is editing a name does not
      -- silently reset the price to the column default of zero -- which would look
      -- like a margin collapse on a screen that reports margins.
      sell_price_minor = coalesce(p_sell_price_minor, p.sell_price_minor),
      updated_at = now()
  where p.id = p_id and p.tenant_id = v_tenant
  returning * into v_row;

  if not found then
    raise exception 'no product % in this tenant', p_id using errcode = 'P0002';
  end if;

  return v_row;
end
$$;

grant execute on function api.create_product(text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer, bigint) to authenticated, service_role;
grant execute on function api.update_product(uuid, text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer, boolean, bigint) to authenticated, service_role;
revoke execute on function api.create_product(text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer, bigint) from public;
revoke execute on function api.create_product(text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer, bigint) from anon;
revoke execute on function api.update_product(uuid, text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer, boolean, bigint) from public;
revoke execute on function api.update_product(uuid, text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer, boolean, bigint) from anon;
drop function if exists api.create_product(text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer);
drop function if exists api.update_product(uuid, text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer, boolean);
