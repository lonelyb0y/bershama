# Security model

What is being defended, from whom, and with what control. Written for someone
reviewing the system before it handles real medicine, not as reassurance.

## Assets

Ranked by how badly their compromise hurts.

1. **Patient safety.** A wrong quantity, a wrong batch, or an expired box reaching
   a pharmacy. Irreversible.
2. **The audit trail.** Worthless if it can be edited. A distrusted audit trail is
   worse than none, because it creates false confidence.
3. **Stock accuracy.** Financial loss and, when it drives allocation, patient
   safety.
4. **Tenant isolation.** Two distributors' commercial data leaking to each other.
5. **Credentials.** Account takeover.
6. **Availability.** A paused or broken system stops deliveries.

## Threat model

| # | Threat | Control |
|---|---|---|
| T1 | A user reads another tenant's data | RLS on every table; isolation suites |
| T2 | A user escalates their own role | Role read from `profiles`, not JWT metadata; `WITH CHECK` on UPDATE |
| T3 | A user forges an audit entry | No client INSERT on `audit_logs`; trigger blocks UPDATE/DELETE |
| T4 | A new table ships unprotected | CI fails if any `public` table lacks RLS |
| T5 | Privileged code becomes callable by clients | `private` schema; CI fails if a `SECURITY DEFINER` function lands in an exposed schema |
| T6 | `search_path` hijacking in a definer function | `set search_path = ''` plus schema-qualified names; CI asserts every `private` function pins it |
| T7 | A view leaks rows | `with (security_invoker = true)` on every exposed view |
| T8 | Secret key leaks into git | `make secrets` in CI; mode 600 on `.env.local`; gitignored |
| T9 | Anonymous sign-up abuse | Invite-only; `enable_signup = false` |
| T10 | Brute-force sign-in | Supabase rate limits; 12-char minimum with mixed case and digits |
| T11 | CSRF on state changes | SameSite cookies, POST-only mutations, no GET sign-out |
| T12 | Offline replay double-delivers | Client-generated idempotency keys, deduplicated server-side |
| T13 | Stock numbers silently diverge from reality | Nightly ledger reconciliation raises `CRITICAL` |
| T14 | Supply-chain compromise of a dependency | pnpm blocks install scripts by default; explicit per-package allowlist; 24-hour minimum release age |
| T15 | A user in a disabled account retains access | `is_active` checked in every RLS helper, not only at sign-in |

### Threats deliberately not designed against

**A malicious operator with database access.** Someone with the `postgres` URL
can read everything. That is the Supabase trust model, and it is why the account
needs MFA and why the connection string is a secret.

**A malicious tenant admin.** A `TENANT_ADMIN` can do anything within their own
tenant, including inviting privileged users. That is the role. Cross-tenant
access is what is prevented.

**Denial of service.** Rate limiting and quota abuse are a Supabase plan feature,
not something this codebase implements. A distributor with a bad actor hammering
the API is out of scope here.

## How the boundary actually works

```
Browser ──publishable key──► Supabase
                              │
                              ├─ JWT identifies the user
                              ├─ request runs as Postgres role `anon` or
                              │  `authenticated`
                              ├─ GRANTS decide which operation is possible
                              └─ POLICIES decide which rows it can touch
```

The publishable key is public. It is meant to be — the same key on any website
reads exactly the same rows and no more. It carries no authority by itself; it
identifies an application, while the user's JWT identifies the person. All
authority is in the policies.

This is why a policy mistake is a breach and not a bug. The defence is
consequently structural:

- `private` schema for anything privileged, `revoke`d from client roles.
- `public` holds tables and policies only.
- `api` holds thin `SECURITY INVOKER` wrappers.
- Every `private` function pins `search_path`.
- Four of the tests exist purely to enforce this shape.

## Known limitations

Stated plainly, because a threat model that lists only solved problems is
marketing.

**The free tier has no downloadable backup.** Before Supabase Pro, there is no
backup that can be exported or verified. This is the largest accepted risk in the
project and is why [ADR 0006](adr/0006-free-tier-then-paid-before-go-live.md)
makes Pro a go-live gate rather than an upgrade.

**A free-tier project can be paused.** Mitigated by an hourly `pg_cron`
keep-alive, which is a mitigation rather than a fix.

**No Egypt data region.** The nearest Supabase regions are Mumbai, Singapore and
Frankfurt. A customer with an in-country residency requirement cannot be served
from this deployment. Region selection is a data-location control, not proof of
regulatory compliance.

**No MFA enforcement yet.** The Postgres-level primitive exists — a `restrictive`
policy on `auth.jwt() ->> 'aal'` — and it should be required for `TENANT_ADMIN`
before go-live. Not yet implemented.

**Rate limiting is inherited, not tuned.** Supabase's defaults are generous for a
pilot. Fine now; review before public exposure.

**No WAF.** Vercel provides baseline protection. A distributor's real deployment
should add rate limiting at the edge.

**Audit logging covers privileged writes.** It does not yet cover every read of
sensitive data, which some regimes expect. A `TENANT_ADMIN` reading a driver's
location is not yet an audit event.

## Before go-live

Not a wish list — a checklist, in `docs/go-live-checklist.md`:

- [ ] Supabase Pro enabled; downloadable backups confirmed working
- [ ] Point-in-time recovery enabled; a restore performed and verified
- [ ] Vercel Pro enabled (Hobby is non-commercial by terms)
- [ ] Custom SMTP configured; email templates branded
- [ ] MFA required for `TENANT_ADMIN`
- [ ] SSL enforcement and network restrictions enabled on the project
- [ ] Supabase account protected with MFA and a hardware key
- [ ] Security Advisor findings reviewed and resolved
- [ ] `make verify` green on the deploy commit
- [ ] Restore drill performed by someone who did not perform the backup
