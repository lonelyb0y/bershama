-- service_role needs to be able to administer the delivery tables.
--
-- scripts/reset-demo-delivery.sh came back 403 on every UPDATE while its DELETE
-- appeared to succeed. Both facts are the same fact: 0042 granted service_role
-- SELECT only, so the service role could read the delivery tables and could not
-- change them. On a Supabase project that is unusual -- service_role is normally
-- granted everything -- and this project's migrations grant privileges explicitly
-- rather than relying on a default, so it needed saying.
--
-- This is a grant to the service role and to nothing else. It is not a client path:
-- authenticated still has SELECT only on these tables, and every write a person can
-- make still goes through an api.* function with its role check and its lifecycle
-- rules. What this adds is the ability to put the demo run back into a demonstrable
-- state, which is a maintenance action and should be possible without a database
-- password on the machine.
--
-- UPDATE and DELETE, not INSERT: a proof of delivery is still only ever written by
-- api.complete_stop. A maintenance script that could insert a delivery record
-- directly would be a hole in the property that matters most here, and this
-- migration does not open it.

grant update, delete on table public.trips to service_role;
grant update, delete on table public.delivery_stops to service_role;
grant delete on table public.proofs_of_delivery to service_role;
grant update on table public.vehicles to service_role;

comment on table public.proofs_of_delivery is
  'Evidence. A SELECT policy and no INSERT/UPDATE/DELETE policy means no client role can write or rewrite a signature; a BEFORE UPDATE trigger enforces the same for the table owner, since RLS is bypassed by the owner and a client with no UPDATE policy gets a silent zero rather than a refusal. INSERT is reachable only through api.complete_stop, which couples the proof to the delivery it evidences and refuses a signature whose stop has not been arrived at. UPDATE and DELETE are granted to service_role alone, for tenant erasure and for scripts/reset-demo-delivery.sh; a hard delete of a run still cascades, which is a deliberate DBA act rather than a silent edit.';
