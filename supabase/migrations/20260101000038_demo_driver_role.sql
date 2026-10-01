-- The demo driver is now actually a driver.
--
-- `driver@demo.local` was seeded as DISTRIBUTOR because there was no DRIVER role to
-- seed it as. Re-pointing it is what makes the M4 driver flow demonstrable, and it
-- is guarded on the account existing so this is a no-op on a database that was
-- never seeded.

update public.profiles p
set role = 'DRIVER',
    updated_at = now()
from auth.users u
where u.id = p.id
  and u.email = 'driver@demo.local'
  and p.role <> 'DRIVER';
