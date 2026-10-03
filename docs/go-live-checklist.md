# Go-live checklist

Work through this before a distributor's real stock, revenue or
patient-safety dependency exists. Not a formality — see
[ADR 0006](../docs/adr/0006-free-tier-then-paid-before-go-live.md) for why.

Owner: ____________  Date: ____________  Reviewed by: ____________

## Blocking — do not skip

### Backups

- [ ] **Supabase Pro enabled.** Removes project pausing and adds PITR.
- [ ] **Downloadable backups confirmed.** Not assumed from the dashboard label —
      actually triggered and downloaded.
- [ ] **Point-in-time recovery enabled.**
- [ ] **A restore has been performed** and the data verified.
- [ ] **The restore was done by someone who did not perform the backup.** A backup
      restored by its own author proves the happy path and nothing else.
- [ ] **Ledger and audit tables present and intact** after the restore. These are
      the records that must not be lost.

> On the free tier there is no downloadable backup at all. This is the single
> largest accepted risk in the project.

### Licensing

- [ ] **Vercel Pro enabled.** Hobby is non-commercial by terms. Hosting a
      distributor's live business on it is a breach.

### Email

- [ ] **Custom SMTP configured.** The free default allows 2 emails/hour, which
      breaks invite-based onboarding past two users.
- [ ] **Auth email templates branded** and pointing at the real domain.
- [ ] **Link tracking disabled** in the SMTP provider. Tracked links break
      Supabase's single-use confirmation links.

### Security

- [ ] **MFA required for `TENANT_ADMIN`.** The `aal` restrictive policy is
      implemented and enabled.
- [ ] **Supabase account protected with MFA**, ideally a hardware key. It has
      administrative access to the whole project.
- [ ] **SSL enforcement enabled.**
- [ ] **Network restrictions configured.**
- [ ] **Email confirmations enabled.**
- [ ] **Security Advisor findings reviewed**, each one either fixed or consciously
      accepted with a reason. Re-run it after every deploy -- see the note below on why
      CI cannot do this for you.

#### Self-serve signup is off until two toggles are flipped

`api.provision_tenant()` and the `/signup` and `/setup` pages are built and deployed, but
nothing can use them until Supabase's **Allow new users to sign up** is enabled.

> **Enable "Confirm email" at the same time.** Sign-ups without confirmation accept
> addresses nobody controls, and password reset goes nowhere for an unconfirmed account.
> The three seeded demo users all have `email_confirmed_at` set, so turning it on does not
> lock them out. With confirmation on, `signUp()` returns no session and the flow
> deliberately routes the new user to `/setup` to finish.

Turning on sign-ups does **not** expose anything, and that is worth being explicit about
during review, because "let anyone register" is the kind of change that should meet
scepticism. Two independent mechanisms hold:

- `private.current_tenant_id()` returns NULL for a user with no `profiles` row, and every
  RLS policy compares `tenant_id` against it. NULL fails every comparison, so every policy
  denies.
- `api.whoami()` returns zero rows for a profileless user, so `getSession()` returns null
  and every authenticated route redirects to `/login`.

So an account that stops before provisioning reads nothing and sees no organisation. The
signup page exists to close that loop, not to breach it.

#### Password strength: the server setting is the one that counts

`apps/web/src/lib/password.ts` enforces a real policy in the signup form -- a 12-character
floor, a blocklist of the passwords that dominate credential-stuffing wordlists, and
rejection of runs, keyboard walks and passwords built from the user's own email. That is the
Free-plan stand-in for leaked-password protection, and it is genuinely useful.

**It is not a security boundary.** It runs in the browser; anyone can POST straight to
`/auth/v1/signup`. So the control that actually holds is GoTrue's own setting:

> **Authentication -> Sign In / Providers -> Email -> Password Strength**

Two things to change there:

1. **Minimum password length: 12.** This is the floor the app assumes, enforced where a
   client cannot reach around it.
2. **Untick the character-class requirements.** GoTrue's defaults demand an uppercase letter,
   a lowercase letter, a digit and a symbol. That directly contradicts this project's policy,
   and NIST SP 800-63B recommends *against* composition rules precisely because they produce
   guessable passwords -- `Password1!` satisfies all four and is in every breach corpus ever
   published.

Until (2) is done the two disagree, and the visible symptom is a strong passphrase being
rejected with *"Password should contain at least one character of each"*. That was observed
against the live project, not predicted. It is a configuration conflict, not a bug in the
policy.

#### Open registration is rate-limited on the Free plan

Confirmed against the live project, and it matters for go-live planning.

With email confirmation enabled, every signup sends an outbound confirmation email, and
Supabase's default limit on the Free plan is low enough that **back-to-back signups return
`429 email rate limit exceeded`**. Observed: the first attempt succeeded, and every subsequent
one in the same window was refused.

So a single admin inviting people one at a time is fine, and genuinely open self-serve
registration is not usable until one of these happens:

- **Upgrade to Pro**, which raises the limit substantially; or
- **Configure custom SMTP** (already on the checklist under Email). A real provider removes
  the Supabase-hosted quota entirely and is what makes confirmation viable at any volume.

The signup form now reports a rate-limit refusal in those words rather than a generic
failure, so this is diagnosable from the UI instead of only from the logs.

#### The two Auth toggles, exactly

Both live in the dashboard, neither is reachable by SQL or by the Supabase MCP, and the
paths move between dashboard versions. As of this writing:

**Leaked password protection** -- Project Settings -> Authentication -> *Email*
provider settings -> **"Prevent use of leaked passwords"**. It sits partway down the same
page as the User Signups toggles, not in that block.

> **Requires the Pro plan.** On Free the toggle is absent and the advisor finding cannot
> be cleared -- it is not a setting you can leave off. Either upgrade, or record the
> finding as consciously accepted with "free plan" as the reason, which is what the item
> above asks for.

The toggle changes nothing for the seeded demo users: it only rejects a password that
matches one in HaveIBeenPwned, and `PharmaFlow#2026` is not one.

**Multi-factor authentication** -- Project Settings -> Authentication -> **MFA** ->
enable the **TOTP** factor. Leave phone and WebAuthn off unless the deployment needs
them; TOTP alone is what clears the `auth_insufficient_mfa_options` advisor finding and it
works with any authenticator app.

Enabling the factor is the dashboard's job. *Requiring* it per role is this application's
job and is a separate, still-open item: the `aal` restrictive policy above is written but
nothing turns it on for `TENANT_ADMIN` yet.

#### Why the Advisor is a human step and not a CI gate

The advisor sees two populations of database objects. Ours are covered by
`supabase/tests/rls_coverage.test.sql` on every push -- and as of this writing that suite
also asserts that no SECURITY DEFINER function in an exposed schema is executable by
`anon`, which is the general form of the `rls_auto_enable` finding.

The platform's are not covered by anything, and cannot be: `verify-db.sh` builds its
cluster from our migrations, so platform objects do not exist in it to be asserted
against. This is not theoretical. `public.rls_auto_enable()` was a postgres-owned definer
reachable by `anon`, it existed only on hosted, and no test here could ever have seen it.
It was found by reading the advisor.

`.github/workflows/advisors.yml` closes that as far as it honestly can: it runs the
advisor against the project on a schedule and on demand, and fails on any finding not in
the committed baseline. It needs `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` as
repository secrets, and it skips with a visible notice rather than passing quietly
without them.
- [ ] **Rate limits reviewed** against expected traffic.
- [ ] **Rotated any key** that was ever pasted into chat, a commit, or a
      screenshot.

## Application

- [ ] `make verify` green on the exact commit being deployed.
- [ ] `make test-db` green: 30 assertions, including cross-tenant isolation and
      the role-escalation attempts.
- [ ] Seed data **not** present in production. `seed.sql` creates demo accounts
      with a known password; it must never have run against the live project.
- [ ] Demo accounts deleted even if the seed was never run.
- [ ] RLS coverage confirmed on the hosted project: every table in `public` has
      policies, and `anon` holds no write grants.
- [ ] `api` schema present in the project's exposed schema list.
- [ ] Locale switcher tested in both directions; RTL layout correct in Arabic.
- [ ] Expiry dates render correctly in both locales, with Latin digits.
- [ ] Offline mode tested on a real phone with the network disabled. A delivery
      completed offline must sync exactly once.

## Operational

- [ ] `docs/runbook.md` read by whoever will be on call.
- [ ] Someone other than the author can deploy a migration.
- [ ] Someone has performed a deploy and a rollback.
- [ ] Monitoring alerts routed to a phone somebody carries.
- [ ] **Expiry and low-stock alert jobs verified running** against real data, and
      the first alert reviewed by a human.
- [ ] **Ledger reconciliation verified green** and someone knows what a
      `CRITICAL` drift alert means before they see one.
- [ ] Named human for patient-safety escalation, reachable out of hours.

## Sign-off

- [ ] Technical readiness confirmed.
- [ ] The distributor's operations lead has seen the runbook.
- [ ] Someone has read the known limitations in `docs/security.md` and accepted
      them.
- [ ] Everyone understands that after this point, a paused or broken database
      stops deliveries — and who to call.

**Do not mark complete while any blocking item is open.**
