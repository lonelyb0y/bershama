-- One api.update_product, not two.
--
-- 0044 created a 20-argument version and asked for the 19-argument one to be
-- dropped, but its drop ran BEFORE the create or replace in the same file, so it
-- removed nothing that mattered and the old signature survived alongside the new
-- one. Two overloads of the same name is the failure this area has now produced
-- three times -- 0028 through 0030 were about private types in signatures, and the
-- generated types turn a name with two signatures into a union across several
-- lines, which the api-types check cannot read. It reported "api.update_product
-- exists in the migrations but is absent from database.types.ts" with both
-- signatures present in the database, which is the kind of message that sends you
-- looking in the wrong place.
--
-- Order matters: drop every signature except the one in use, and drop by the full
-- argument list, because dropping by name alone would take the one that stays.

drop function if exists api.update_product(uuid, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer);

comment on function api.update_product(uuid, text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer, boolean) is
  'The only api.update_product. One signature, on purpose: see 0047 for what a second one costs in the generated types and in check-api-types.';

-- Asserted so the next signature change cannot reintroduce it silently. Overloads of
-- one api.* name are the recurring defect in this schema, and they are invisible
-- until a client resolves the wrong one.
do $$
declare
  v_dupes text;
begin
  -- count(*) cannot appear inside string_agg in the same query, so the tally is
  -- taken first and formatted second.
  select string_agg(name || ' x' || n::text, ', ') into v_dupes
  from (
    select p.proname as name, count(*) as n
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'api'
    group by p.proname
    having count(*) > 1
  ) dupl;

  if v_dupes is not null then
    raise exception 'api functions with more than one signature: %', v_dupes;
  end if;
end
$$;
