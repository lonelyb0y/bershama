# 0002. The `private` / `api` / `public` schema split

Status: Accepted — **amended during M2**, see the Amendment below.

## Context

Bershama's business logic is `SECURITY DEFINER` Postgres functions. That is not
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

## Amendment: the `api` wrappers are DEFINER where they write

Recorded during M2, because implementation contradicted the original decision and
the implementation is right.

The original decision was that every `api` function is `SECURITY INVOKER`, so that
"RLS applies to everything the wrapper reads." That is correct for **reads** and it
is what `api.search_products`, `api.get_product` and `api.get_batch_stock` do.

It cannot work for **writes**, and the reason is structural rather than a matter of
taste: `private` carries no `USAGE` grant to client roles — that is the entire point
of the schema split. An `INVOKER` wrapper executes as `authenticated` and therefore
**cannot call a `private.*` function at all**. Every write path died with
`permission denied for schema private` before reaching any logic.

The alternative — granting `USAGE` on `private` to `authenticated` — is the one
thing this ADR exists to prevent: every privileged function becomes directly
callable by any signed-in client, which is a total loss of tenant isolation.

So a write wrapper must be `SECURITY DEFINER` in order to reach the code that
validates its input. **That makes the wrapper itself the security boundary**, and
every one of them does its own authorisation in this order:

1. `private.require_inventory_write()` — refuses a role that may not move stock
2. `private.current_tenant_id()` — scope, resolved from the session, never from input
3. the `private` implementation, which re-checks the tenant on every row it touches

`rls_coverage.test.sql` enforces the split: no `SECURITY DEFINER` function may
appear in `public`, and the ones in `api` must be on an explicit allow-list. The
list is fail-closed, so a new DEFINER wrapper fails the build until someone decides
on purpose that it belongs in an exposed schema — which is the moment to ask
whether it does.

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
- **A write wrapper is now a security boundary in its own right.** It runs as
  `postgres`, so RLS no longer backstops it; the role check and tenant scoping
  inside the function are the only thing standing between a signed-in user and the
  data. A wrapper copied without its `require_inventory_write()` call is a
  privilege escalation. The coverage test catches an unlisted DEFINER function but
  cannot catch a listed one whose check was deleted, so this still relies on review
  — which is why the check is the first line of every wrapper rather than a
  convention stated once in a comment.
- **Schema proliferation.** Four schemas for a small system. Justified by the
  boundary, but it is complexity bought deliberately.
- **`api` must be added to the project's exposed schema list** on a hosted
  project. A deploy step that, if forgotten, produces a permission error rather
  than a security hole — the safe direction to fail.
