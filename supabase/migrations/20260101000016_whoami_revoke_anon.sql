-- Take EXECUTE on api.whoami() back from anon.
--
-- Migration 0015 dropped and recreated api.whoami to add full_name_ar, because
-- postgres will not let create or replace change a function's return type
-- (42P13). Dropping it discarded the revoke that 0014 had applied, and every new
-- function gets EXECUTE from PUBLIC by default -- so anon could call whoami
-- again until this ran.
--
-- The pgTAP assertion "anon cannot EXECUTE any function in the api schema"
-- failed the moment 0015 landed, which is the suite doing precisely its job.
--
-- 0015 also carries this revoke, so a fresh database is never in the bad state
-- at any point. This file exists because 0015 had already been applied to the
-- hosted project before the revoke was added, and a migration that has run
-- cannot be re-run by editing it.
--
-- Worth carrying forward: changing a function's shape means restating its
-- privileges. create or replace keeps them, drop does not.

-- from public, not just from anon.
--
-- postgres grants EXECUTE to PUBLIC on every function it creates. Revoking from
-- `anon` alone removes the direct grant but leaves the PUBLIC one, and
-- has_function_privilege('anon', ...) then still answers true by inheritance --
-- which is exactly what the pgTAP assertion reported after 0015.
revoke execute on function api.whoami() from public;
revoke execute on function api.whoami() from anon;

grant execute on function api.whoami() to authenticated, service_role;
