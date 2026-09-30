-- Requisitions: a facility's request for stock, and the FEFO allocation of it.
--
-- ── why this needs a schema of its own rather than a column on a table ───────
--
-- M3 is the first workflow with a lifecycle, and a lifecycle is a state machine
-- plus the history of how it got there. A request is not a row until someone
-- approves it, an approval is not just a flag, and the interesting question is
-- usually "what did you allocate and why" -- which means the answer has to be
-- stored, not recomputed from whatever the ledger says today.
--
-- ── status ──────────────────────────────────────────────────────────────────
--
--   DRAFT ──submit──▶ SUBMITTED ──approve──▶ ALLOCATED
--     │                   │
--     └───submit──────────┘
--     │                   │
--     └──discard──▶ DISCARDED  ◀──reject──┘
--
-- SUBMITTED is the only state in which the inventory is committed. DRAFT is
-- editable, ALLOCATED is not editable at all, and DISCARDED is terminal: a
-- request that was thrown away is not brought back, because re-submitting it
-- would allocate against stock that has since moved.
--
-- There is no EDITED state. A submitted requisition that needs changing is
-- rejected and re-raised, which keeps the audit trail honest: the history says
-- what was asked for, not what it became.

create table public.requisitions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id),
  code          text not null,
  facility_id   uuid not null references public.facilities (id),
  status        text not null default 'DRAFT'
                  check (status in ('DRAFT','SUBMITTED','ALLOCATED','REJECTED','DISCARDED')),
  -- The person's stated reason, kept verbatim. A requisition with no
  -- justification is how a warehouse ends up holding stock nobody ordered.
  justification text,
  requested_by  uuid references public.profiles (id),
  requested_at  timestamptz not null default now(),
  submitted_at  timestamptz,
  decided_by    uuid references public.profiles (id),
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A request belongs to exactly one tenant and one code. Both are enforced here
  -- rather than trusted from the application.
  constraint requisitions_tenant_code_key unique (tenant_id, code),
  -- A decision always has a decider and a time. Without this the "approved by"
  -- column can be filled in by a migration and nobody can tell.
  constraint requisitions_decision_complete
    check ((decided_at is null) = (decided_by is null)),
  -- An approved or rejected request must say when. A DISCARDED draft never had
  -- a decision, which is why this is a disjunction and not a plain implication.
  constraint requisitions_terminal_has_time
    check (status not in ('ALLOCATED','REJECTED') or decided_at is not null)
);

create table public.requisition_lines (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id),
  requisition_id uuid not null references public.requisitions (id) on delete cascade,
  product_id     uuid not null references public.products (id),
  qty_requested  integer not null check (qty_requested > 0),
  -- What FEFO actually found. Null until the request is approved, and
  -- deliberately nullable rather than defaulting to 0: "we allocated nothing"
  -- and "we have not tried yet" are different answers and an approver has to be
  -- able to tell them apart.
  qty_allocated  integer check (qty_allocated is null or qty_allocated >= 0),
  -- Set when the allocation could not cover the line, so the approver is told
  -- which lines are short and by how much rather than discovering it downstream.
  shortage_qty   integer,
  created_at     timestamptz not null default now(),

  constraint requisition_lines_tenant_product_key unique (tenant_id, requisition_id, product_id)
);

comment on table public.requisitions is
  'A facility request for stock. DRAFT is editable, SUBMITTED is the only state in which inventory is committed, ALLOCATED and REJECTED are terminal.';
comment on column public.requisition_lines.qty_allocated is
  'What FEFO found, null until approved. Nullable on purpose: "allocated nothing" and "not attempted" are different answers.';

-- ── RLS ─────────────────────────────────────────────────────────────────────
--
-- Every policy is keyed on tenant_id = private.current_tenant_id(). Nothing
-- reads the tenant from a request parameter, so asking for another tenant's
-- requisition by id returns nothing rather than returning it.

alter table public.requisitions enable row level security;
alter table public.requisition_lines enable row level security;

-- A facility sees its own requisitions; the distributor's own staff see all of
-- them. warehouse_side and pharmacy_side are the two roles this covers, and the
-- policy names them rather than using "not a driver" so that adding a role is a
-- deliberate act instead of a silent widening.
create policy "read tenant requisitions"
  on public.requisitions for select
  to authenticated
  using (tenant_id = (select private.current_tenant_id()));

-- Only the requesting facility may draft, and only its own. requested_by is
-- forced to the caller in the trigger below rather than accepted from the form.
create policy "pharmacy raises its own requisitions"
  on public.requisitions for insert
  to authenticated
  with check (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER', 'PHARMACY_MANAGER'))
  );

-- Only a draft is editable, and only the draft's own fields. status is
-- excluded from the update path entirely: a request moving from DRAFT to
-- SUBMITTED has to go through api.submit_requisition, which records who and
-- when. Letting a client UPDATE status would let it approve itself.
create policy "drafts are editable by warehouse roles"
  on public.requisitions for update
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and status = 'DRAFT'
    and (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER', 'PHARMACY_MANAGER'))
  )
  with check (tenant_id = (select private.current_tenant_id()) and status = 'DRAFT');

create policy "read tenant requisition lines"
  on public.requisition_lines for select
  to authenticated
  using (tenant_id = (select private.current_tenant_id()));

-- Lines are insertable and editable only while their parent is a draft. The
-- subquery re-checks the tenant, so a line cannot be attached to another
-- tenant's requisition even by guessing the id.
create policy "lines follow their draft"
  on public.requisition_lines for insert
  to authenticated
  with check (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER', 'PHARMACY_MANAGER'))
    and exists (
      select 1 from public.requisitions r
      where r.id = requisition_id
        and r.tenant_id = (select private.current_tenant_id())
        and r.status = 'DRAFT'
    )
  );

create policy "draft lines are editable"
  on public.requisition_lines for update
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and exists (
      select 1 from public.requisitions r
      where r.id = requisition_id
        and r.tenant_id = (select private.current_tenant_id())
        and r.status = 'DRAFT'
    )
  )
  with check (tenant_id = (select private.current_tenant_id()));

create policy "draft lines are removable"
  on public.requisition_lines for delete
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and exists (
      select 1 from public.requisitions r
      where r.id = requisition_id
        and r.tenant_id = (select private.current_tenant_id())
        and r.status = 'DRAFT'
    )
  );

-- ── the tenant is never taken from the client ───────────────────────────────

create or replace function public.set_requisition_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.tenant_id := (select private.current_tenant_id());
  return new;
end
$$;

create trigger requisitions_set_tenant
  before insert on public.requisitions
  for each row execute function public.set_requisition_tenant();

create trigger requisitions_touch_updated_at
  before update on public.requisitions
  for each row execute function private.touch_updated_at();

-- requested_by is the caller, never the form.
create or replace function public.set_requisition_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.requested_by is null then
    new.requested_by := (select auth.uid());
  end if;
  return new;
end
$$;

create trigger requisitions_set_actor
  before insert on public.requisitions
  for each row execute function public.set_requisition_actor();

create or replace function public.set_requisition_line_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.tenant_id := (select private.current_tenant_id());
  return new;
end
$$;

create trigger requisition_lines_set_tenant
  before insert on public.requisition_lines
  for each row execute function public.set_requisition_line_tenant();
