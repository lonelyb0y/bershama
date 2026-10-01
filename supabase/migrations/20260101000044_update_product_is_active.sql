-- is_active belongs to the product update.
--
-- The catalogue form edits a product and its active flag together, and the previous
-- arrangement made that two round trips: api.update_product for the fields, then
-- api.set_product_active for the flag. Two transactions for one edit means the
-- first can land and the second fail, leaving a product whose name was changed and
-- whose status was not -- a state no screen in the application offers and no
-- operator asked for.
--
-- api.set_product_active stays, because toggling a product from the list is a
-- separate job with its own role check and its own message. This is the form's
-- field arriving with the rest of the form.

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
  p_is_active boolean default null
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

  -- The SKU is editable here, unlike in 0032, because the catalogue form treats it
  -- as a field of the product rather than as its identity: the identity is the id,
  -- and a distributor correcting a typo in a SKU has to be able to. It is still
  -- unique, and the constraint still refuses a duplicate.
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
      uom = coalesce(nullif(btrim(coalesce(p_uom, '')), ''), 'unit')::private.stock_unit,
      atc_code = nullif(upper(btrim(coalesce(p_atc_code, ''))), ''),
      gtin = nullif(btrim(coalesce(p_gtin, '')), ''),
      eda_reg_no = nullif(btrim(coalesce(p_eda_reg_no, '')), ''),
      requires_prescription = coalesce(p_requires_prescription, false),
      is_controlled = coalesce(p_is_controlled, false),
      is_cold_chain = coalesce(p_is_cold_chain, false),
      shelf_life_months = coalesce(p_shelf_life_months, 1),
      -- null means "leave it alone", so a caller that does not care about the flag
      -- does not silently activate a retired product.
      is_active = coalesce(p_is_active, p.is_active),
      updated_at = now()
  where p.id = p_id and p.tenant_id = v_tenant
  returning * into v_row;

  if not found then
    raise exception 'no product % in this tenant', p_id using errcode = 'P0002';
  end if;

  return v_row;
end
$$;

revoke execute on function api.update_product(uuid, text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer, boolean) from public;
revoke execute on function api.update_product(uuid, text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer, boolean) from anon;

grant execute on function api.update_product(uuid, text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer, boolean) to authenticated, service_role;

comment on function api.update_product(uuid, text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer, boolean) is
  'Edit a catalogue product, including its active flag. The flag came in as its own argument because the catalogue form edits both together, and making that two round trips left a product whose name had been changed and whose status had not -- a state no screen offers and no operator asked for. Pass null to leave the flag alone.';

-- The allow-list and the private-type assertion both enumerate api.* by name, and
-- this signature replaces one whose arity changed. rls_coverage counts the declared
-- functions, so the older signature is dropped rather than left behind: two
-- overloads with different arities is how 0028 through 0030 happened.
drop function if exists api.update_product(uuid, text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer);