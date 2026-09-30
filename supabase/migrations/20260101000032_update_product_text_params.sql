-- api.update_product: take text, cast inside.

-- The last function still carrying a `private` type in its parameter list, and
-- therefore the last one a browser cannot call. `db update_product -- private`
-- measured exactly one, in 29.
--
-- The same correction as 0030: a `private` type in a signature is resolved by
-- PostgREST when a value is passed, and resolving it needs USAGE on `private`,
-- which a client role has by design. The error names the schema, not the
-- function.
--
-- ── a correction to something I said earlier ────────────────────────────────

-- I previously flagged api.quarantine_batch, api.release_batch,
-- api.recall_batch and api.stock_take as having the same problem, on the
-- strength of a grep for `p_to_status private.batch_status`. They do not.
-- Those functions take only a batch id and a reason -- the enum was a local
-- VARIABLE inside the body, which is fine, because a local declaration is
-- resolved as the owner and never by the caller.
--
-- I asserted a hazard that does not exist in code I had not read properly. The
-- lesson is the one this schema keeps teaching: grep for the thing, then read
-- where it actually is. A pgTAP assertion below now covers the real rule, so
-- this cannot be re-derived wrongly a third time.

create or replace function api.update_product(
  p_id uuid,
  p_name_en text,
  p_name_ar text,
  p_generic_name_en text default null,
  p_generic_name_ar text default null,
  p_brand text default null,
  p_form text default 'TABLET',
  p_strength text default '',
  p_strength_unit text default null,
  p_pack_size integer default 1,
  p_uom text default 'BOX',
  p_atc_code text default null,
  p_gtin text default null,
  p_eda_reg_no text default null,
  p_requires_prescription boolean default false,
  p_is_controlled boolean default false,
  p_is_cold_chain boolean default false,
  p_shelf_life_months integer default 24
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.products;
begin
  if not (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER')) then
    raise exception 'only a warehouse manager may edit a product' using errcode = '42501';
  end if;

  if btrim(coalesce(p_name_en, '')) = '' or btrim(coalesce(p_name_ar, '')) = '' then
    raise exception 'both names are required' using errcode = '22023';
  end if;

  -- sku is deliberately absent from the parameter list. It is the product's
  -- identity, it appears on every printed label and delivery note already in
  -- circulation, and changing it is a data-migration decision rather than an edit
  -- a warehouse supervisor makes from a form.
  update public.products p
  set name_en = btrim(p_name_en),
      name_ar = btrim(p_name_ar),
      generic_name_en = nullif(btrim(coalesce(p_generic_name_en, '')), ''),
      generic_name_ar = nullif(btrim(coalesce(p_generic_name_ar, '')), ''),
      brand = nullif(btrim(coalesce(p_brand, '')), ''),
      form = coalesce(nullif(btrim(p_form), '')::private.product_form, 'TABLET'::private.product_form),
      strength = coalesce(btrim(p_strength), ''),
      strength_unit = nullif(btrim(coalesce(p_strength_unit, '')), '')::private.strength_unit,
      pack_size = p_pack_size,
      uom = coalesce(nullif(btrim(p_uom), '')::private.stock_unit, 'BOX'::private.stock_unit),
      atc_code = upper(nullif(btrim(coalesce(p_atc_code, '')), '')),
      gtin = nullif(btrim(coalesce(p_gtin, '')), ''),
      eda_reg_no = nullif(btrim(coalesce(p_eda_reg_no, '')), ''),
      requires_prescription = p_requires_prescription,
      is_controlled = p_is_controlled,
      is_cold_chain = p_is_cold_chain,
      shelf_life_months = p_shelf_life_months,
      updated_at = now()
  where p.id = p_id
    and p.tenant_id = (select private.current_tenant_id())
  returning * into v_row;

  if not found then
    raise exception 'no product % in this tenant', p_id using errcode = 'P0002';
  end if;

  return v_row;
end
$$;

-- Active or inactive, never deleted. A product can be years deep in batches,
-- movements and audit history, and a hard delete would either cascade through all
-- of that or fail on the foreign keys -- and either way destroy the evidence that
-- the stock existed.
create or replace function api.set_product_active(p_id uuid, p_active boolean)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.products;
begin
  if not (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER')) then
    raise exception 'only a warehouse manager may change a product''s status'
      using errcode = '42501';
  end if;

  update public.products p
  set is_active = p_active, updated_at = now()
  where p.id = p_id and p.tenant_id = (select private.current_tenant_id())
  returning * into v_row;

  if not found then
    raise exception 'no product % in this tenant', p_id using errcode = 'P0002';
  end if;

  return v_row;
end
$$;

grant execute on function api.update_product(uuid, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer) to authenticated, service_role;
revoke execute on function api.update_product(uuid, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer) from public;
revoke execute on function api.update_product(uuid, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer) from anon;

comment on function api.update_product(uuid, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer) is
  'Update a catalogue product. sku is deliberately not a parameter: it is the product''s identity and appears on printed labels already in circulation.';

drop function if exists api.update_product(api.update_product(uuid, text, text, text, text, text, private.product_form, text, text, integer, private.stock_unit, text, text, text, boolean, boolean, boolean, integer));
