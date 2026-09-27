-- ============================================================================
-- 0007_batches.sql
-- batches: one lot of one product, and alert_events for reconciliation.
--
-- A batch is a state machine, not a boolean. `is_active = false` cannot
-- distinguish "received and awaiting inspection" from "the regulator recalled
-- it", and those demand different actions from completely different people.
--
-- Batches are NEVER hard-deleted. A lot number that appears in an audit trail
-- must still resolve to its batch years later, and a hard delete would make an
-- old document unverifiable. A mistake is corrected by a compensating stock
-- movement plus deleted_at, and only when no stock remains.
-- ============================================================================

-- ── batches ─────────────────────────────────────────────────────────────────

create table public.batches (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  product_id   uuid not null references public.products (id) on delete restrict,

  -- The lot number printed on the carton. Unique per product, not per tenant:
  -- a manufacturer may legitimately reuse a lot number on a different product.
  lot_number   text not null check (length(btrim(lot_number)) > 0),

  mfg_date     date not null,
  expiry_date  date not null,

  -- An expiry date on or before the manufacture date is a data-entry error that
  -- would otherwise surface as "expired on arrival".
  check (expiry_date > mfg_date),

  -- Money as integer minor units. See ADR 0004.
  unit_cost_minor bigint not null default 0 check (unit_cost_minor >= 0),

  -- QUARANTINED on insert, deliberately. Received goods are not available for
  -- supply until someone inspects and releases them, which under WHO GDP is a
  -- distinct state with a named person responsible for it. A default of RELEASED
  -- would make the safe path the one that requires remembering to change it.
  status       private.batch_status not null default 'QUARANTINED',

  supplier_name text,
  supplier_ref  text,

  -- Reason and actor for the state change. Every transition records both, so
  -- "why is this lot quarantined" is answerable without reading the audit log.
  status_reason text,
  status_changed_at timestamptz,
  status_changed_by uuid references public.profiles (id) on delete set null,

  -- Set when the batch becomes RELEASED, for the GDP release record.
  released_at  timestamptz,
  released_by  uuid references public.profiles (id) on delete set null,

  received_at  timestamptz not null default now(),

  -- Soft delete. Never hard-deleted: a lot number in an audit trail must still
  -- resolve to its batch years later.
  deleted_at   timestamptz,
  deleted_by   uuid references public.profiles (id) on delete set null,
  delete_reason text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (tenant_id, product_id, lot_number)
);

comment on table public.batches is
  'One lot of one product. Never hard-deleted, because a lot number in an audit '
  'trail must still resolve to its batch years later. A correction is a '
  'compensating stock movement plus deleted_at, and only when no stock remains.';

comment on column public.batches.status is
  'A state machine, not a boolean. QUARANTINED (received, awaiting inspection) '
  'and RECALLED (withdrawn by a manufacturer or regulator) demand different '
  'actions from different people, and one flag cannot express both.';

comment on column public.batches.unit_cost_minor is
  'Integer minor units, never a float. See docs/adr/0004.';

-- The expiry index is the one that earns its keep: the expiry report, the
-- FEFO ordering in M3, and the nightly alert scan are all "batches ordered by
-- expiry date" over the tenant.
create index batches_tenant_expiry_idx on public.batches (tenant_id, expiry_date);
create index batches_product_idx on public.batches (tenant_id, product_id);

-- Partial: deleted batches are excluded from every query that matters, and
-- keeping them out of the index keeps it small.
create index batches_active_idx
  on public.batches (tenant_id, status, expiry_date)
  where deleted_at is null;

-- A shelf-life sanity check. A batch whose expiry implies a shelf life wildly
-- different from the product's declared default is almost always a data-entry
-- error, and catching it here is cheaper than discovering it at expiry.
create or replace function private.check_shelf_life_sane()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_declared integer;
  v_expected interval;
  v_days     integer;
  v_exp_days integer;
begin
  select p.shelf_life_months into v_declared
  from public.products p
  where p.id = new.product_id;

  if v_declared is null then
    return new;
  end if;

  v_expected := make_interval(months => v_declared);

  -- `date - date` yields an INTEGER number of days in Postgres, not an interval.
  -- Assigning that to an interval variable makes it a bare day count, and
  -- extract(epoch ...) on that returns 0 -- which compared like a plausible
  -- shelf life and made the check either useless or absurd. Compare the integer
  -- directly.
  v_days     := (new.expiry_date - new.mfg_date);
  v_exp_days := extract(epoch from v_expected) / 86400;

  if v_exp_days <= 0 then
    return new;
  end if;

  -- Permissive on purpose. A generous tolerance catches a transposed year or a
  -- month mistyped as a day, which are the real errors, without rejecting a batch
  -- that legitimately ran slightly long or short.
  if v_days < v_exp_days * 0.5 or v_days > v_exp_days * 1.75 then
    raise exception using
      errcode = 'P0001',
      message = 'shelf_life_implausible',
      detail  = json_build_object(
        'expected_months', v_declared,
        'actual_days',     v_days,
        'min_days',        floor(v_exp_days * 0.5),
        'max_days',        ceil(v_exp_days * 1.75)
      )::text;
  end if;

  return new;
end;
$$;

comment on function private.check_shelf_life_sane() is
  'Rejects a batch whose implied shelf life is far from the product default. '
  'Raises the error code shelf_life_implausible with the actual and expected '
  'days as JSON detail, so the client can localise the message rather than '
  'displaying an English sentence.';

create trigger batches_shelf_life_check
  before insert or update of mfg_date, expiry_date on public.batches
  for each row execute function private.check_shelf_life_sane();

-- ── alert_events ────────────────────────────────────────────────────────────
--
-- Needed now, not in M5, because reconciliation writes to it. The M5 work is the
-- alert centre UI, the expiry and low-stock scans, and the notification fan-out.

create type private.alert_type as enum (
  'LOW_STOCK', 'NEAR_EXPIRY', 'EXPIRED', 'OVERSTOCK',
  'ORDER_OVERDUE', 'DELIVERY_FAILED', 'COLD_CHAIN_BREACH', 'RECALL',
  -- Invariant breaches. These are not advice: they mean the data cannot be
  -- trusted, and they belong in the same table precisely so nothing can filter
  -- them out of a count.
  'STOCK_DRIFT', 'NEGATIVE_STOCK'
);

create type private.alert_severity as enum ('INFO', 'WARN', 'CRITICAL');
create type private.alert_status as enum ('OPEN', 'ACK', 'RESOLVED', 'SNOOZED');

create table public.alert_events (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  type         private.alert_type not null,
  severity     private.alert_severity not null default 'WARN',

  -- What the alert is about, as a type/id pair. Polymorphic rather than a
  -- nullable FK per target: an alert can point at a product, a batch, a
  -- location or a requisition, and four nullable columns with three constraints
  -- to keep them consistent is worse than a tagged reference.
  entity_type  text not null,
  entity_id    text,

  message      text not null,
  -- Structured payload so a client can render a specific message without parsing
  -- the human-readable one. See the error-code convention in 0009.
  data         jsonb not null default '{}'::jsonb,

  status       private.alert_status not null default 'OPEN',
  acknowledged_by   uuid references public.profiles (id) on delete set null,
  acknowledged_at   timestamptz,
  resolved_at  timestamptz,
  resolved_by  uuid references public.profiles (id) on delete set null,

  -- A nightly scan must not create the same alert every night. The uniqueness is
  -- partial, so a resolved alert can legitimately be re-raised if the problem
  -- recurs, which is the behaviour a warehouse manager expects.
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  occurrences   integer not null default 1,

  created_at   timestamptz not null default now()
);

comment on table public.alert_events is
  'Operational and invariant alerts. STOCK_DRIFT and NEGATIVE_STOCK mean the '
  'numbers cannot be trusted and belong in the same table precisely so they '
  'cannot be filtered out of a count.';

-- One open alert per (type, entity). The unique index is what stops a nightly
-- scan from creating hundreds of duplicates.
create unique index alert_events_one_open_idx
  on public.alert_events (tenant_id, type, entity_type, coalesce(entity_id, ''))
  where status = 'OPEN';

create index alert_events_tenant_status_idx
  on public.alert_events (tenant_id, status, severity, created_at desc);

-- ── triggers ────────────────────────────────────────────────────────────────

create trigger batches_touch_updated_at
  before update on public.batches
  for each row execute function private.touch_updated_at();

create trigger batches_enforce_tenant
  before insert or update of tenant_id on public.batches
  for each row execute function private.assert_single_tenant();

-- Audit batches by trigger rather than by function. The status transitions in
-- 0009 are functions, but the audit trail should not depend on a future write
-- path remembering to call an audit helper.
create trigger batches_audit
  after insert or update on public.batches
  for each row execute function private.audit_row_change();

-- ── grants ──────────────────────────────────────────────────────────────────

revoke all on table public.batches, public.alert_events
  from anon, authenticated;

-- Batches are readable by anyone in the tenant: a pharmacist asking what they
-- hold, an admin seeing expiries, a driver scanning a carton.
--
-- Writes are NOT granted. A batch carries a state machine with mandatory reasons
-- and side effects, and a client with a direct UPDATE grant could set
-- status = 'RELEASED' with no reason and no record of who did it. Creation and
-- every transition go through api.* in 0009 instead.
grant select on table public.batches to authenticated;

-- Alerts are read-only to clients; the nightly jobs in private.* write them.
grant select on table public.alert_events to authenticated;

-- Sequences: the alert table has a uuid key, but stock_ledger in 0008 uses a
-- bigint identity column and needs this.
grant usage, select on all sequences in schema public to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.batches      enable row level security;
alter table public.alert_events enable row level security;

create policy "read tenant batches"
  on public.batches for select
  to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy "read tenant alerts"
  on public.alert_events for select
  to authenticated
  using (tenant_id = (select private.current_tenant_id()));

-- Alert acknowledgement is a client action and carries no invariant, so it is a
-- direct write rather than a function. The WITH CHECK pins tenant and prevents
-- reopening a resolved alert from a different tenant.
create policy "update own tenant alerts"
  on public.alert_events for update
  to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));

create trigger alert_events_enforce_tenant
  before insert or update of tenant_id on public.alert_events
  for each row execute function private.assert_single_tenant();

create trigger alert_events_touch_updated_at
  before update on public.alert_events
  for each row execute function private.touch_updated_at();
