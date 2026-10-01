-- sell_price_minor on the product write functions.
--
-- A column nothing can write is a column that stays 0, and 0 everywhere means the
-- margin report shows a margin of minus the entire cost of stock, which is worse
-- than showing nothing because it looks like a real number.
--
-- Both functions are replaced rather than altered, because their signatures change:
-- create_product gains a defaulted argument at the end, and update_product gains one
-- too. Postgres resolves a call by argument list, so a default on a new trailing
-- parameter would leave the old signature callable and the old function alive, and
-- this schema has now produced three accidental overloads by accident. The old ones
-- are dropped explicitly at the end, by full argument list, and the drop comes
-- after the create so it removes the superseded definition rather than nothing.

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
    nullif(btrim(coalesce(p_strength_unit, '')), ''),
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
      strength_unit = nullif(btrim(coalesce(p_strength_unit, '')), ''),
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

-- The superseded signatures, named in full. See 0047 for what leaving these behind
-- costs: the generated types collapse an overloaded name into a union that the
-- api-types check cannot read, and the message it then gives points at the wrong
-- place.
drop function if exists api.create_product(text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer);
drop function if exists api.update_product(uuid, text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer, boolean);

comment on function api.update_product(uuid, text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer, boolean, bigint) is
  'Edit a catalogue product. p_is_active null leaves the flag alone, and p_sell_price_minor null leaves the price alone -- both because a partial edit that resets the fields it did not mention is worse than one that leaves them, and a price silently returned to zero reads as a margin collapse on any screen reporting margins.';
