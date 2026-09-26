# 0002. The `private` / `api` / `public` schema split

Status: Accepted

## Context

PharmaFlow's business logic is `SECURITY DEFINER` Postgres functions. That is not
a stylistic choice — it is how the product gets correctness. `post_stock_movement()`
must append to the ledger and update the balance in one transaction, and
`allocate_requisition_fefo()` must read available batches and write allocations
without another writer slipping in between. Both need privileges the `authenticated`
role does not have.

`SECURITY DEFINER` means the function runs with the privileges of its owner. On
Supabase the owner is `postgres`, which carries `BYPASSRLS`. So a
`SECURITY DEFINER` function can read and write every row of every tenant.

Supabase exposes to the Data API every schema listed in the project's API
settings — `public` and `graphql_public` by default, and an administrator can add
more.

Those two facts combine into a total loss of isolation. A `SECURITY DEFINER`
function in an exposed schema can be called by any signed-in user, and it runs as
the superuser. Not "a privilege escalation" — the complete absence of tenant
isolation, executing valid-looking code.

It is also the kind of mistake that is invisible in review. A function in
`public` is where Postgres developers expect functions to be. The file looks
correct. The tests pass, because nothing asserts the schema.

Two lesser traps in the same family:

**`search_path` hijacking.** A `SECURITY DEFINER` function without
`set search_path = ''` resolves unqualified names using the caller's `search_path`
first. A caller can create an object that shadows a name inside the function, and
the function will use theirs while running with the owner's privileges. Every such
function pins `search_path` and schema-qualifies every name.

**Views.** Postgres creates views `security definer` by default, so a view over a
protected table hands out every row the policies withheld. A view in an exposed
schema needs `with (security_invoker = true)`.

## Decision

Four schemas, split by privilege rather than by subject area:

| Schema | Contents | Exposed |
|---|---|---|
| `private` | `SECURITY DEFINER` implementations, RLS helpers | **never** |
| `api` | thin `SECURITY INVOKER` wrappers | yes |
| `public` | tables, policies, views | yes |
| `auth` | Supabase-managed | managed |

Enforced by:

- `revoke all on schema private from public` in the first migration.
- `set search_path = ''` and schema-qualified names in every `private` function.
- `revoke execute on all functions in schema api from public`, then grant per
  function.
- `alter default privileges` in `api` so new functions are not implicitly
  executable.
- **A test suite that fails the build** if a `SECURITY DEFINER` function appears
  in `public` or `api`, or if a `private` one loses its pinned `search_path`.

The wrappers exist so the client has a small, stable, auditable surface. Each one
is a thin function that delegates to `private`, so the RLS policy still governs
who may call it.

## Consequences

### Positive

- **Total loss of isolation becomes structurally impossible.** Not "we reviewed
  carefully" — impossible, and checked by a test that runs on every push.
- **The security boundary is reviewable as a list of schemas**, rather than as a
  judgement about every function.
- **The test suite is the regression guard.** A future function added to the
  wrong schema fails CI immediately.
- **Privileged logic is findable.** Everything sensitive is in one place.

### Negative

- **An extra hop.** Every privileged operation is a wrapper calling into
  `private`. Slightly more code, one more layer to read.
- **The wrapper must be careful.** A wrapper marked `SECURITY INVOKER` runs as the
  caller, which is correct, but a future edit that changes it to `DEFINER` for
  convenience would reintroduce the whole problem. The coverage test catches
  placement, not the invoker/definer flag on a function in `api`, so this relies
  on review.
- **Schema proliferation.** Four schemas for a small system. Justified by the
  boundary, but it is complexity bought deliberately.
- **`api` must be added to the project's exposed schema list** on a hosted
  project. A deploy step that, if forgotten, produces a permission error rather
  than a security hole — the safe direction to fail.
