-- ============================================================================
-- 0003_audit.sql
-- Append-only audit log. Required by WHO GDP and it is the first thing an
-- auditor asks for. Also the mechanism that makes a "who changed this stock
-- number" question answerable.
--
-- Append-only is enforced by trigger, not convention: an UPDATE or DELETE
-- raises. Corrections are new rows.
-- ============================================================================

create table public.audit_logs (
  id            bigint generated always as identity primary key,
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  actor_user_id uuid references public.profiles (id) on delete set null,
  -- Retained even when the profile is deleted, so the trail survives offboarding.
  actor_label   text,
  actor_role    private.app_role,
  action        text not null,
  entity_type   text not null,
  entity_id     text,
  before        jsonb,
  after         jsonb,
  request_id    uuid,
  ip_address    inet,
  user_agent    text,
  occurred_at   timestamptz not null default now()
);

create index audit_logs_tenant_time_idx on public.audit_logs (tenant_id, occurred_at desc);
create index audit_logs_entity_idx      on public.audit_logs (tenant_id, entity_type, entity_id);
create index audit_logs_actor_idx       on public.audit_logs (tenant_id, actor_user_id);

comment on table public.audit_logs is
  'Append-only audit trail. Rows cannot be updated or deleted, by any role.';

-- Immutability. SECURITY DEFINER is irrelevant here; the trigger raises for
-- everyone including the table owner, which is the point.
create or replace function private.deny_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'audit_logs is append-only; % is not permitted', tg_op
    using errcode = '42501';
end;
$$;

create trigger audit_logs_immutable
  before update or delete on public.audit_logs
  for each row execute function private.deny_audit_mutation();

revoke all on table public.audit_logs from anon, authenticated;
grant select on table public.audit_logs to authenticated;

alter table public.audit_logs enable row level security;

-- Auditors and admins read the trail. No client writes: entries are created by
-- private.write_audit() from inside the same transaction as the change itself,
-- so a successful change and its audit row commit or roll back together.
create policy "admins and auditors read audit log"
  on public.audit_logs for select
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role('TENANT_ADMIN', 'ANALYST'))
  );

-- ── audit writer ────────────────────────────────────────────────────────────

create or replace function private.write_audit(
  p_action      text,
  p_entity_type text,
  p_entity_id   text default null,
  p_before      jsonb default null,
  p_after       jsonb default null,
  p_request_id  uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (
    tenant_id, actor_user_id, actor_label, actor_role,
    action, entity_type, entity_id, before, after, request_id
  )
  values (
    (select private.current_tenant_id()),
    (select auth.uid()),
    (select p.full_name from public.profiles p where p.id = (select auth.uid())),
    (select private.current_role()),
    p_action, p_entity_type, p_entity_id, p_before, p_after, p_request_id
  )
$$;

comment on function private.write_audit is
  'Records an audit row using the caller identity. Must be called inside the '
  'same transaction as the change being recorded.';
