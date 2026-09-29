-- Return the caller's Arabic name from api.whoami.
--
-- The interface is bilingual and the session was not. whoami returned
-- full_name only, so the header showed the Latin spelling of a person's name on
-- the Arabic page -- an Egyptian operator reading Arabic saw "Ahmed Hassan" in
-- Latin script at the top of every screen, and the greeting did the same.
--
-- Adding a column to a function's return type is not possible in place, so this
-- is a full redefinition rather than `alter function ... returns table`. The
-- grants are restated because create or replace drops the existing privileges on
-- the function, and a silent grant loss on an api function shows up as a
-- permission error for every caller, not as a failed migration.
--
-- full_name_ar stays nullable. Plenty of staff records have no Arabic name on
-- file, and the interface falls back to the Latin one rather than rendering an
-- empty header; the column is nullable so that is representable rather than
-- being a NOT NULL constraint that the seed would have to satisfy forever.
--
-- The drop is required, not tidiness: postgres refuses to let create or replace
-- alter a function's return type (42P13), because callers compiled against the
-- old row shape. Migrations run in a transaction, so the gap between the drop
-- and the create is not observable from outside.

drop function if exists api.whoami();

create or replace function api.whoami()
returns table (
  user_id      uuid,
  tenant_id    uuid,
  role         private.app_role,
  full_name    text,
  full_name_ar text,
  locale       text,
  tenant_slug  text,
  currency_code char(3),
  vat_rate     numeric,
  timezone     text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (select auth.uid()),
    t.id,
    p.role,
    p.full_name,
    p.full_name_ar,
    p.locale,
    t.slug,
    t.currency_code,
    t.vat_rate,
    t.timezone
  from public.profiles p
  join public.tenants t on t.id = p.tenant_id
  where p.id = (select auth.uid())
    and p.is_active
$$;

comment on function api.whoami() is
  'Identity, tenant and role of the caller. Returns zero rows for an unknown, inactive or profileless user, which every caller must read as "no session" rather than as a broken tenant.';

grant execute on function api.whoami() to authenticated, service_role;

-- The drop above removed the revoke that migration 0014 applied to this
-- function, and postgres grants EXECUTE to PUBLIC by default on every new
-- function. So recreating it silently handed `anon` execute on whoami again --
-- which is the exact thing 0014 exists to prevent, and the pgTAP assertion
-- "anon cannot EXECUTE any function in the api schema" failed on the very next
-- run.
--
-- This is the trap in dropping a function to change its return type: the
-- security posture is part of what gets thrown away, and it has to be restated
-- explicitly. A future migration that redefines an api function has to remember
-- this, or the suite will catch it -- which is what the suite is for.
-- from public, not just from anon.
--
-- postgres grants EXECUTE to PUBLIC on every function it creates. Revoking from
-- `anon` alone removes the direct grant but leaves the PUBLIC one, and
-- has_function_privilege('anon', ...) then still answers true by inheritance --
-- which is exactly what the pgTAP assertion reported after 0015.
revoke execute on function api.whoami() from public;
revoke execute on function api.whoami() from anon;
