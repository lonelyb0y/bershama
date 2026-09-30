-- Undo: `private` is not reachable by PostgREST, including its login role.
--
-- ── what happened ───────────────────────────────────────────────────────────
--
-- While debugging the M2 write failure I granted USAGE on `private` to
-- `authenticator`, PostgREST's own login role, on the theory that statements are
-- prepared as that role and so could not resolve a `private.` reference.
--
-- It did not help: the failing writes still returned 42501. What the experiment
-- actually established is that the grant has to be held by the *client* role --
-- PostgREST plans with the caller's role active -- and that is precisely the
-- grant this suite exists to forbid.
--
-- So the fix was the wrong one, the suite said so, and this undoes it.
--
-- ── the real conclusion, which is more useful than the grant ────────────────
--
-- An RLS policy whose expression calls a `private` function is unreachable from
-- a client, full stop. Verified rather than reasoned: with USAGE granted to
-- `authenticated` the failing insert becomes a 201, and without it, 42501.
--
-- Therefore direct table writes are not available to this application, and every
-- write must go through an `api.*` SECURITY DEFINER function -- which is what
-- every other write in this project already did. The catalogue form that wrote
-- tables directly is the exception, and it is the bug.
--
-- Recorded here because the next person to hit a 42501 on a policy will be
-- tempted by exactly the grant this migration removes.

revoke usage on schema private from authenticator;

comment on schema private is
  'Internal helpers. No role that a client can become holds USAGE here -- not anon, not authenticated, and not PostgREST''s own login role -- so no client request can name the schema. rls_coverage.test.sql asserts all three.';
