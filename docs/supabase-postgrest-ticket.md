# Supabase support ticket — PostgREST ignores the `api` schema

**Project:** `kswdttkwtqqlabcjsgcy`
**Severity:** blocking — the application has no data layer
**Plan:** Free

## Summary

PostgREST serves only `public` on this project. The `api` schema is never exposed, so
every RPC the application makes returns `PGRST202` and the app cannot read or write
anything. Configuration is correct at every layer that can be inspected, and a full
service restart does not change it.

## Impact

The application is a Next.js app that reads and writes exclusively through supabase-js
`.rpc()`, which is PostgREST. `api.whoami()` returning nothing makes the server session
helper return `null`, and every authenticated route redirects to `/login`. This is a
total outage of the data layer, not a degraded mode.

## What has been verified

| Probe | Result |
|---|---|
| `GET /v1/projects/{ref}/postgrest` | `"db_schema": "public,graphql_public,api"` |
| `ALTER ROLE authenticator` | `pgrst.db_schemas=public, graphql_public, api` |
| `has_schema_privilege('authenticator','api','USAGE')` | `true` |
| `has_schema_privilege('authenticated','api','USAGE')` | `true` |
| `has_schema_privilege('anon','api','USAGE')` | `false` (expected) |
| A **newly created** function in `public` | exposed by the next `NOTIFY pgrst, 'reload schema'` |
| A newly created **table** in `public` | exposed by the same notification |
| A function in `api` | `PGRST202`, never exposed |

That last pair is the important one: the schema cache is demonstrably **alive** — a new
`public` object appears within seconds of the notification. So the cache is not stale,
and the notification is being received. The list PostgREST is *configured* with simply
does not contain `api`.

Error returned for every `api` function:

```json
{
  "code": "PGRST202",
  "details": "Searched for the function public.whoami without parameters or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.",
  "message": "Could not find the function public.whoami without parameters in the schema cache"
}
```

It resolves the name to `public.whoami` — consistent with only `public` being searched.

## Things already tried

- `PATCH /v1/projects/{ref}/postgrest` with `db_schema` — returns HTTP 200, and the value
  reads back correctly afterwards.
- `NOTIFY pgrst, 'reload config'` — no effect.
- `NOTIFY pgrst, 'reload schema'` — no effect for `api`; demonstrably works for `public`.
- Project **pause → restore** (full `INACTIVE` → `ACTIVE_HEALTHY` cycle).
- `POST /v1/projects/{ref}/restart` (restart all services) — no effect.
- Branching, to get a fresh project with correct defaults — refused, Pro-only.
- Confirmed the `api` schema is owned by `postgres` and that `anon` correctly lacks USAGE
  on it.

## What is wanted

Confirmation of whether the running PostgREST container's `PGRST_DB_SCHEMAS` environment
variable matches what the config API reports, and a fix or a workaround.

The working read is that the stored config is not being propagated into the container's
environment — the value the API returns is not the value the process is running with.

The application is functional in the meantime, by mirroring the `api` surface into
`public` as INVOKER wrappers generated from `pg_proc`. That is a band-aid and worth
removing rather than maintaining. Reproduction details are available on request.

## Supporting detail

- 49 functions in `api`, 9 of which return `SETOF`/`TABLE`.
- `authenticator` has USAGE on `api`, so the functions are visible to introspection.
- `graphql_public` is also listed in `db_schema` but `authenticator` lacks USAGE on it —
  mentioned only because it appears to share the symptom.