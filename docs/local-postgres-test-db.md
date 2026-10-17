# PostgreSQL for the test suite — no root required

`make test-db` is the only gate that needs the PostgreSQL **server** binaries, and
they are not the same as the `psql` client. `psql` alone gives you:

```
FAIL initdb not found. Install the PostgreSQL SERVER package (not just the
     client): it provides initdb and pg_ctl under /usr/lib/postgresql/<major>/bin.
```

`verify-db.sh` starts a throwaway cluster, applies all 73 migrations plus the
seed, and runs the 13 pgTAP suites. On this machine it had never run, because
the server packages were absent and installing them needed root.

## What this sets up

Fedora 44 RPMs, extracted into the user account rather than installed:

| Path | What |
|---|---|
| `~/.local/pgsql/bin/` | `initdb`, `pg_ctl`, `psql`, `postgres`, … (symlinks) |
| `~/.cache/replay-scratch/pg/root/usr/lib64/` | `libpq.so`, `libpq.so.private18-5` |
| `~/.cache/replay-scratch/pg/root/usr/lib64/pgsql/` | extensions: `pgcrypto.so` |

Four RPMs are needed, and the fourth is the one that is easy to miss:

```bash
dnf download --arch=x86_64 postgresql postgresql-server postgresql-libs
dnf download --arch=x86_64 postgresql-private-libs   # libpq.so.private18-5
dnf download --arch=x86_64 postgresql-contrib        # pgcrypto.so
```

Without `postgresql-private-libs`, every server binary fails with
`libpq.so.private18-5: cannot open shared object file`. Without
`postgresql-contrib`, the migrations fail on `create extension pgcrypto`.

## PGSHAREDIR is the non-obvious part

The server looks for extensions in the `$libdir` it was compiled against —
`/usr/lib64/pgsql` — which is not writable without root. Setting `PGSHAREDIR`
redirects that lookup, and is what makes `create extension pgcrypto` resolve.

## Using it

```bash
source ~/.local/pgsql/env.sh
make test-db        # 13 suites, 340 assertions
```

Add that `source` to `~/.zshrc` to make it the default. `env.sh` sets three
variables: `PATH`, `LD_LIBRARY_PATH` and `PGSHAREDIR`.

`scripts/verify-db.sh` also probes `/usr/lib/postgresql/*/bin` and
`/usr/pgsql-*/bin`, so a normal system install is still found with no
configuration at all. This setup exists only because neither path is writable
here.

## What this does not give you

`make db` — the full local Supabase stack — still needs Docker or Podman, and
neither is installed. That matters for one gate: `make e2e` signs in as
`admin@demo.local`, an account that exists only in `supabase/seed.sql`. Without
a database, all 67 of its tests fail at sign-in. That is environmental, not a
code defect; the 18 tests that need no session pass.