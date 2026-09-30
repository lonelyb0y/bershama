-- Drop every api.update_product overload, then define exactly one.
--
-- I have now written this drop three times from memory and got it wrong every
-- time. Each failure was silent: `drop function if exists` with a signature that
-- does not exist is a no-op, so the stale overload survived and the local build
-- and the hosted database ended up with different sets of functions. The
-- assertion caught it -- "update_product, update_product" -- which is the whole
-- reason the assertion exists.
--
-- So: enumerate pg_proc and drop each overload by its OWN regprocedure. That is
-- immune to me getting a signature right, and it is the pattern to use whenever
-- a signature has to change, because a changed signature is a NEW function, not
-- a replacement.
--
-- Then one definition, with text parameters, so there is exactly one thing to
-- grant.

do $do$
declare
  v record;
begin
  for v in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.proname = 'update_product'
  loop
    execute format('drop function if exists %s', v.sig);
  end loop;
end
$do$;

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
