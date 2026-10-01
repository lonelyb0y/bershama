-- Grants for the M4 tables, which 0035 wrote policies on and nobody could read.
--
-- The same omission 0024 corrected for the requisitions: RLS decides WHICH rows a
-- client may see, and the GRANT decides whether it may ask. A SELECT policy on a
-- table the role has no privilege on is not access, it is a policy about nothing --
-- every read returns "permission denied for table trips" rather than an empty list.
--
-- SELECT only. Writes go through api.* (0036) because the tenant triggers call
-- private.*, which a client role cannot name -- so an INSERT grant would be a
-- privilege the client could not exercise, which is worse than not having it,
-- because the error message says "permission denied" and points at the wrong thing.
--
-- The driver surface reads all four tables and writes none of them, which is why
-- this is a read grant and nothing more: the phone in a van needs to see its run.

grant select on table public.vehicles to authenticated, service_role;
grant select on table public.trips to authenticated, service_role;
grant select on table public.delivery_stops to authenticated, service_role;
grant select on table public.proofs_of_delivery to authenticated, service_role;

-- The API schema has to be reachable for the writes to resolve over HTTP at all.
grant usage on schema api to authenticated, service_role;