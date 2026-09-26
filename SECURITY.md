# Security Policy

## Reporting

**Do not open a public issue for a security finding.** It is public the moment you
submit it, and a leaked secret or a working tenant-isolation bypass is
exploitable the moment it is read.

Report privately through GitHub's **Security → Report a vulnerability** on the
repository, or by email to the maintainer.

Please include: what is affected, how to reproduce it, and the impact. A
reproduction is worth more than a hypothesis.

### What to expect

| | |
|---|---|
| Acknowledgement | within 3 days |
| Assessment | within 7 days |
| Fix or mitigation plan | within 14 days |
| Public disclosure | coordinated with you, after a fix is released |

## Severity

Judged by impact on the system of record for a pharmaceutical supply chain.

**Critical**

- Cross-tenant data access of any kind.
- Any path to `BYPASSRLS` — a `SECURITY DEFINER` function reachable from a
  client, a `private` function without a pinned `search_path`.
- Forgery or modification of audit entries.
- A leaked `sb_secret_…` key, or a live database connection string.
- Sign-in bypass, or privilege escalation from any role to `TENANT_ADMIN`.

**High**

- Modification of stock quantities or batch status without the audited path.
- Reading another user's personal data within a tenant.
- Inability of a client to invoke an `api.*` function it should reach, or its
  ability to reach one it should not.

**Medium**

- Denial of service reachable without authentication.
- Missing constraint that permits an invalid state — a negative price, a batch
  expiring before it was manufactured.
- Missing index causing a timeout on a real query shape.

**Low**

- Anything requiring an already-privileged role to exploit.
- Missing hardening headers with no exploitable consequence.

## Supported versions

M1 is pre-production. Until a release is tagged, fixes land on `main` and there
are no supported older versions.

Once a release exists, the current minor version is supported.

## Before go-live

Two things are structural risks rather than bugs, and no amount of engineering
closes them on a free tier. Both are on the go-live checklist in
[docs/go-live-checklist.md](docs/go-live-checklist.md):

- **Supabase Pro.** The free tier provides no downloadable database backup. A
  system of record for batch numbers and expiry dates, with no backup that can be
  exported or restored, is not recoverable.
- **Vercel Pro.** The Hobby plan is restricted to non-commercial personal use by
  its terms. Hosting a distributor's live business on it is a breach.

## Hardening already in place

For context on what a report is *not*. Each has a test.

- RLS on every public table, enforced by the database.
- Privileged functions confined to an unexposed `private` schema, with
  `search_path` pinned.
- Roles read from a table, never from editable JWT metadata.
- Append-only audit log; `UPDATE` and `DELETE` raise for every role including
  the owner.
- No client `INSERT` on any public table; every write is an audited function call.
- Invite-only; no public signup.
- CI fails if a secret key appears in the tree, if any public table lacks RLS, or
  if a `SECURITY DEFINER` function lands in an exposed schema.
- A CI job deliberately weakens a policy to confirm the isolation suites can
  fail — a security test that cannot fail is not a test.
