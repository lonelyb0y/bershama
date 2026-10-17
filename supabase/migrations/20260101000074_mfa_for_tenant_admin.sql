-- ============================================================================
-- M6 go-live: require MFA (aal2) for TENANT_ADMIN writes.
--
-- A restrictive policy is ANDed with every permissive policy, so adding one
-- does not relax anything that is already allowed.  It only adds a condition:
-- a TENANT_ADMIN may write only when their session has reached aal2, i.e.
-- they have completed a second factor.
--
-- The check is deliberately tolerant of a missing `aal` claim.  When MFA is
-- not enabled in Supabase the JWT carries no `aal` at all, and in that state
-- the policy must not lock every admin out.  Enforcement kicks in automatically
-- the moment MFA is turned on and GoTrue starts emitting `aal: 'aal1'` for
-- un-upgraded sessions.
--
-- Non-admin roles are unaffected: the policy's first clause is true for them.
-- ============================================================================

-- Helper: is the caller a TENANT_ADMIN whose session has not reached aal2?
-- Kept as a function so the policy reads as intent rather than as JWT plumbing,
-- and so the test suite can override it if needed.
create or replace function private.tenant_admin_requires_mfa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select private.has_role('TENANT_ADMIN'))
    and coalesce((select auth.jwt() ->> 'aal'), 'aal2') <> 'aal2'
$$;

comment on function private.tenant_admin_requires_mfa() is
  'True when the caller is a TENANT_ADMIN whose JWT has not reached aal2. '
  'Used by the MFA restrictive policies. Returns false when the JWT carries '
  'no aal claim, so MFA is not enforced until Supabase is configured to '
  'emit one.';

-- One restrictive policy per table where TENANT_ADMIN holds a write grant.
-- `for all` covers insert, update and delete in one declaration; select is
-- governed by the existing permissive policies and is not restricted, because
-- requiring MFA to read would break every dashboard view.

do $$
declare
  t text;
begin
  foreach t in array array[
    'alert_events',
    'facilities',
    'invitations',
    'products',
    'profiles',
    'requisition_lines',
    'requisitions',
    'storage_locations'
  ] loop
    execute format(
      'create policy "mfa required for tenant admin" '
      'on public.%I as restrictive for all to authenticated '
      'using (not private.tenant_admin_requires_mfa())',
      t
    );
  end loop;
end
$$;

comment on policy "mfa required for tenant admin" on public.alert_events is
  'M6 go-live: TENANT_ADMIN writes require aal2 (completed MFA).';
comment on policy "mfa required for tenant admin" on public.facilities is
  'M6 go-live: TENANT_ADMIN writes require aal2 (completed MFA).';
comment on policy "mfa required for tenant admin" on public.invitations is
  'M6 go-live: TENANT_ADMIN writes require aal2 (completed MFA).';
comment on policy "mfa required for tenant admin" on public.products is
  'M6 go-live: TENANT_ADMIN writes require aal2 (completed MFA).';
comment on policy "mfa required for tenant admin" on public.profiles is
  'M6 go-live: TENANT_ADMIN writes require aal2 (completed MFA).';
comment on policy "mfa required for tenant admin" on public.requisition_lines is
  'M6 go-live: TENANT_ADMIN writes require aal2 (completed MFA).';
comment on policy "mfa required for tenant admin" on public.requisitions is
  'M6 go-live: TENANT_ADMIN writes require aal2 (completed MFA).';
comment on policy "mfa required for tenant admin" on public.storage_locations is
  'M6 go-live: TENANT_ADMIN writes require aal2 (completed MFA).';