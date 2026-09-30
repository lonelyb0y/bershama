-- Grant the PostgREST login role USAGE on `private`.
--
-- ── why ─────────────────────────────────────────────────────────────────────
--
-- PostgREST connects as `authenticator` and switches to the caller's role for
-- each request. The statement is PREPARED while the session role is still
-- `authenticator`, and a schema-qualified reference is resolved at prepare time.
-- `private` is unreachable for `authenticator` (revoke all ... from public in
-- 0001, and no grant has restored it), so every statement whose policy or
-- trigger body names a `private` object failed:
--
--   42501 permission denied for schema private
--
-- `SET LOCAL ROLE authenticated` does not help, because by the time it takes
-- effect the statement has already been planned. The grant is what makes the
-- name resolvable in the first place.
--
-- ── why this is not a hole in `private` ──────────────────────────────────────
--
-- USAGE on a schema is name resolution, not access. It lets a role *name* the
-- schema; it grants no privilege on anything inside it. What `authenticator` can
-- then do is still bounded by:
--
--   - every function in `private` is SECURITY DEFINER with `set search_path = ''`
--     and fully qualified bodies, so calling one runs with the owner's rights
--     and the caller's arguments are the only input;
--   - `authenticator` holds no grants on any table, which is asserted in
--     rls_coverage.test.sql;
--   - it is not superuser and does not bypass RLS (rolsuper = false,
--     rolbypassrls = false), so every policy still applies to the real role.
--
-- This is the same shape as migration 0012, which granted `authenticator` USAGE
-- on the `api` schema for the same reason.
--
-- The assertion that actually matters is unchanged and still enforced: `anon` and
-- `authenticated` have no USAGE on `private`. A client cannot name the schema.

grant usage on schema private to authenticator;

comment on schema private is
  'Internal helpers. USAGE is held by the PostgREST login role (authenticator) so statements can be prepared, and by nothing a client can be. anon and authenticated have no USAGE here, which rls_coverage.test.sql asserts.';
