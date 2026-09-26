# Local development

Two ways to run the database, same SQL in both. Pick whichever your machine
allows.

## Path A — full Supabase stack (Docker)

The normal path. Gives you the whole platform locally: Auth, Storage, Realtime,
pg_cron, and Studio.

```bash
make db        # start the stack
make db-reset  # apply migrations + seed
make dev       # http://localhost:3000
```

`supabase start` prints the local keys. They are identical for every developer
and safe to commit, which is why they are in `.env.example`.

To use your own hosted project instead, put its ref and keys in `.env.local` and
`make link`.

### Docker permission

The Supabase CLI needs access to `/var/run/docker.sock`. If you get
`permission denied while trying to connect to the docker API`:

```bash
sudo usermod -aG docker $USER
```

Then log out and back in. Group membership needs a new login session to take
effect, which is the part that usually gets missed.

## Path B — plain PostgreSQL (no Docker)

For locked-down machines, CI runners, and anywhere the full stack is
unnecessary. Runs the real migrations and the real test files against a
throwaway cluster.

```bash
make test-db
```

Requirements: `initdb`, `pg_ctl`, `psql` on `PATH` (PostgreSQL 14+).

The script creates a temporary cluster in `/tmp`, applies
`supabase/migrations/*` in order, applies the seed, runs every suite, and tears
the cluster down. Nothing is left behind and no port is held.

### What the harness adds

Two files exist only for this path and are **never** applied to a hosted project:

- `supabase/tests/0000_supabase_compat.sql` — creates the `anon`,
  `authenticated` and `service_role` roles, the `auth` schema, `auth.users`,
  `auth.identities` and `auth.uid()`. Supabase provisions these; a plain server
  does not.
- `supabase/tests/pgtap_shim.sql` — a pgTAP-compatible assertion shim, installed
  only when the real `pgtap` extension is unavailable.

`supabase db push` only pushes `supabase/migrations/*`, so neither can reach a
hosted project by accident.

### Why the shim exists

pgTAP is a system package and installing it needs root. Rather than skip the
security tests on machines without it, the shim implements the assertions the
suites use — `plan`, `ok`, `is`, `is_empty`, `results_eq`, `throws_ok`,
`lives_ok`, `finish` — with pgTAP's semantics.

The distinction that matters: the query assertions (`is_empty`, `results_eq`,
`throws_ok`, `lives_ok`) are deliberately `SECURITY INVOKER`. If they were
`SECURITY DEFINER`, their dynamic `EXECUTE` would run as `postgres` with
`BYPASSRLS`, every policy under test would be bypassed, and the tenant-isolation
suites would pass no matter how broken the policies were.

When the real extension is present, `verify-db.sh` uses it and prints which one
ran. It does not pretend.

## Environment variables

`.env.local` lives at the **repository root** — Next.js resolves it from the
project root, not from `apps/web`.

```bash
make env        # copies .env.example, sets mode 600
```

Then fill in the values by hand. Four variables:

| Variable | Prefix | Visibility |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | bundled — safe, it is a hostname |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | bundled — safe, RLS limits it |
| `SUPABASE_SECRET_KEY` | none | **server only** |
| `NEXT_PUBLIC_SITE_URL` | public | bundled — auth redirect allowlist |

The `NEXT_PUBLIC_` prefix is how Next decides what reaches the browser. The
secret key deliberately has no prefix.

New-style keys are `sb_publishable_…` and `sb_secret_…`. A key starting with
`eyJ` is a legacy JWT `anon`/`service_role` key, deprecated end of 2026.

**Never paste the secret key into chat, a commit, or a screenshot.** `make
secrets` fails the build if one appears in the tree, and CI runs it.

## Everyday commands

```bash
make help       # everything
make doctor     # what is and is not available
make check      # lint, types, unit tests, secret scan
make test-db    # migrations + 30 RLS assertions
make verify     # all of it, what CI runs
```

## A change to the schema

1. Edit `supabase/migrations/`. Never edit the hosted database directly.
2. `make test-db` — proves the migrations apply and the suites still pass.
3. `make check`.
4. If the schema was changed in the dashboard by accident, `supabase db diff -f
   <name>` captures it into a migration so the repository is authoritative again.

## Adding a table

The order is not optional:

1. `create table` with `tenant_id` and the constraints.
2. `revoke all on table … from anon, authenticated`.
3. `grant` back only the operations the client needs.
4. `alter table … enable row level security`.
5. Write the policies. Always name the role: `to authenticated`.
6. Add a test under `supabase/tests/` — `rls_coverage.test.sql` will already be
   failing until step 4 is done, which is the point.

Skipping step 2 leaves the table writable by any signed-in user, and adding a
policy does not fix it.
