-- Making `maintenance` routable without making it callable.
--
-- 0051 asserted that the maintenance schema has no USAGE for the PostgREST
-- authenticator, and that was wrong. PostgREST includes a schema in its routing
-- table only if it holds USAGE on it, so a schema it cannot see is not merely
-- protected -- it is unreachable by anybody, including the service role the function
-- exists for. The reset script answered PGRST106, Invalid schema.
--
-- The model this project already uses for `api` is the correct one, and 0051 was
-- asserting against it rather than with it:
--
--   * `authenticator` gets USAGE, so PostgREST can route the request.
--   * EXECUTE is granted per function, so routing is not calling. A request that
--     reaches a function the caller has no EXECUTE on is refused by PostgreSQL, not
--     hidden by PostgREST -- which means the refusal is accurate and appears in a log
--     rather than as a 404 that looks like a typo.
--
-- So: authenticator and service_role get USAGE, exactly as for `api`. Nothing else
-- changes. anon and authenticated still have no USAGE and no EXECUTE, so no client
-- can name the schema at all, and the one function in it is granted only to
-- service_role.
--
-- 0053 asserts the resulting shape, including that `private` is still sealed.

grant usage on schema maintenance to authenticator;
grant usage on schema maintenance to service_role;

comment on schema maintenance is
  'Operational tasks that are not product features. Shaped exactly like `api` in the one respect that matters for PostgREST: the authenticator holds USAGE so requests can be routed, and EXECUTE is granted per function, so routing is not calling. anon and authenticated hold neither, so no client can name the schema. 0053 asserts that, and asserts that `private` remains sealed to service_role -- which 0049 breached and 0050 reversed.';
