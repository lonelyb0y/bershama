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
      accepted with a reason.
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
