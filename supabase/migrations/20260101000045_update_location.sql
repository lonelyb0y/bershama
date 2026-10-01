-- api.update_location, which the storage-location edit form has been calling.
--
-- The catalogue migration added api.create_location and no update counterpart, and
-- the form's edit branch went straight to the table instead. So editing a location
-- was a direct table write -- refused with 42501, because the tenant trigger calls
-- private.* -- while the create branch worked through the function. Nothing
-- asserted the pair existed, so the asymmetry survived until a test drove the form.
--
-- Note what is not editable here: facility_id. A location belongs to the facility
-- whose stock it holds, and moving one between facilities is not an edit -- it is a
-- transfer, and it needs the stock moved with it. Refusing it here is deliberate.

create or replace function api.update_location(
  p_id uuid,
  p_code text,
  p_name_en text,
  p_name_ar text,
  p_kind text default null,
  p_temp_min_c numeric default null,
  p_temp_max_c numeric default null
)
returns public.storage_locations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select private.current_tenant_id());
  v_row    public.storage_locations;
begin
  if v_tenant is null then
    raise exception 'no tenant for the current session' using errcode = '42501';
  end if;

  if not (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER')) then
    raise exception 'only a warehouse manager may edit a storage location' using errcode = '42501';
  end if;

  if btrim(coalesce(p_code, '')) = '' then
    raise exception 'a storage location needs a code' using errcode = '22023';
  end if;

  update public.storage_locations l
  set code = btrim(p_code),
      name_en = btrim(p_name_en),
      name_ar = btrim(p_name_ar),
      kind = coalesce(nullif(btrim(coalesce(p_kind, '')), ''), 'AMBIENT')::private.location_kind,
      temp_min_c = p_temp_min_c,
      temp_max_c = p_temp_max_c,
      updated_at = now()
  where l.id = p_id and l.tenant_id = v_tenant
  returning * into v_row;

  if not found then
    raise exception 'no storage location % in this tenant', p_id using errcode = 'P0002';
  end if;

  return v_row;
end
$$;

grant execute on function api.update_location(uuid, text, text, text, text, numeric, numeric) to authenticated, service_role;
revoke execute on function api.update_location(uuid, text, text, text, text, numeric, numeric) from public;
revoke execute on function api.update_location(uuid, text, text, text, text, numeric, numeric) from anon;

comment on function api.update_location(uuid, text, text, text, text, numeric, numeric) is
  'Edit a storage location. facility_id is deliberately absent: a location holds stock for one facility, and moving it between facilities is a transfer that has to move the stock with it, not an edit to a label.';

-- Where the counterpart is checked, and why not here.
--
-- The catalogue form's edit branch called api.update_location, which did not exist,
-- and nothing failed until a test drove the form. The tempting guard is a query
-- asserting every api.create_* has an api.update_* -- and it is wrong, because
-- api.create_vehicle and api.create_trip genuinely have no update counterpart: a
-- vehicle is not edited after it exists, and a run is either moved on or cancelled,
-- never edited. A check that cannot tell the difference between "deliberately not
-- updatable" and "forgotten" is worse than none.
--
-- The real guard is in the client. supabase.rpc() was untyped, so a name that did
-- not exist compiled and failed at runtime; the Supabase clients are now
-- parameterised with the generated Database, which makes rpc() check the name and
-- the arguments at compile time. A missing counterpart is now a type error in the
-- form that calls it, which is where the mistake was.
