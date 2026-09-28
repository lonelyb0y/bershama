-- Tell the running PostgREST to re-read its configuration.
--
-- Split out of 20260101000013 because a migration cannot reliably signal the
-- PostgREST process, and because these two notifications are needed together
-- far more often than they are remembered together.
--
--   'reload config'  -- the schema LIST changed. Without this, PostgREST reloads
--                       its cache while still configured for one schema, and the
--                       api functions stay invisible however often you send
--                       'reload schema' on its own.
--   'reload schema'  -- the set of OBJECTS changed (a migration added tables
--                       or functions). Needed after `db push` as well.
--
-- Safe to run at any time, including against a hosted project.
--
--   psql "$DATABASE_URL" -f scripts/expose-api-schema.sql

notify pgrst, 'reload config';
notify pgrst, 'reload schema';

\echo ''
\echo 'Notified PostgREST. Confirm with:'
\echo '  make hosted-check        (deployed project)'
\echo '  make db-expose-api       (local stack, includes the notifications)'
