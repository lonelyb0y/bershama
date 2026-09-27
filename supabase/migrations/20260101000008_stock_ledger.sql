-- ============================================================================
-- 0008_stock_ledger.sql
-- The append-only ledger and its materialised balances.
--
-- See docs/adr/0003-append-only-stock-ledger.md. The short version:
--
--   stock_ledger      every movement, forever, immutable
--   stock_balances    current position, maintained BY A TRIGGER
--
-- The trigger is the point. private.post_stock_movement() in 0009 inserts ONE
-- ledger row; the AFTER INSERT trigger below updates the balance. There is no
-- second code path that writes a balance, so "the balance disagrees with the
-- ledger" is not a state the database can be put into. Reconciliation became a
-- detector rather than a repair mechanism, because there is nothing to repair.
--
-- This is an amendment to ADR 0003, which originally had the function writing
-- both rows. The reasoning and the cost are recorded in the ADR.
-- ============================================================================

-- ── stock_ledger ────────────────────────────────────────────────────────────

create table public.stock_ledger (
  -- bigint identity, not a uuid. The ledger is the largest table in the system
  -- and grows with every movement; a monotonic bigint is half the index size of
  -- a uuid and sorts in insertion order, which makes the "most recent movements"
  -- query a plain ordered scan rather than a sort.
  id           bigint generated always as identity primary key,

  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  facility_id  uuid not null references public.facilities (id) on delete restrict,
  location_id  uuid not null references public.storage_locations (id) on delete restrict,
  product_id   uuid not null references public.products (id) on delete restrict,
  batch_id     uuid not null references public.batches (id) on delete restrict,

  -- Declared for the M2 serial work (products.is_serialised), NULL throughout M2.
  -- Nullable so the lot-level path is unaffected.
  serial_id    uuid,

  -- Signed. Inbound types must be positive and outbound negative; the CHECK
  -- below ties qty_delta to txn_type so a mis-signed ISSUE cannot inflate stock.
  -- Zero is meaningless: a movement that changes nothing is noise in an audit
  -- trail, and allowing it would let a caller pad the ledger.
  qty_delta    bigint not null check (qty_delta <> 0),

  txn_type     private.movement_type not null,

  -- What caused this movement: a requisition, a purchase receipt, a stocktake.
  -- Polymorphic for the same reason as alert_events: the referent varies by
  -- movement type and the M3 tables do not exist yet.
  reference_type text,
  reference_id   text,

  -- Cost at the time of the movement, so a historical valuation does not shift
  -- when a batch is repriced. Nullable: a COUNT_GAIN has no cost basis.
  unit_cost_minor bigint,

  -- A reason code, not prose. Reason codes are what get counted, and a
  -- free-text field yields "typo" eleven different ways.
  reason_code  text,
  notes        text,

  -- Who moved it. Nullable because a pg_cron job has no authenticated user; the
  -- trigger from 0005 falls back to a system label in that case.
  actor_user_id uuid references public.profiles (id) on delete set null,

  -- When the movement happened, which may differ from when it was recorded: a
  -- delivery booked on the 3rd for goods that arrived on the 1st.
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),

  -- The sign rule. Kept as a named constraint so a future test can assert on it
  -- by name, and so the intent is legible in \d output.
  constraint stock_ledger_sign_matches_type check (
    (txn_type in ('RECEIPT','TRANSFER_IN','COUNT_GAIN','RECALL_RELEASE') and qty_delta > 0)
    or (txn_type in ('ISSUE','DISPENSE','TRANSFER_OUT','COUNT_LOSS','WRITE_OFF','RECALL_QUARANTINE') and qty_delta < 0)
    or (txn_type in ('ADJUSTMENT','RETURN') and qty_delta <> 0)
  )

  -- No constraint ties serial_id to batch_id, because there is no serials table
  -- until the v2 serial work. Writing one now would be theatre: the obvious form
  -- (`serial_id in (select id from serials where batch_id = ...)`) cannot be
  -- written because the table does not exist, and a placeholder like
  -- `serial_id is null or true` is a tautology that reads like a guarantee and
  -- enforces nothing. The real check lands with the table it depends on.
);

comment on table public.stock_ledger is
  'Append-only record of every stock movement. UPDATE and DELETE are rejected by '
  'trigger for every role including the owner, so a mistake is corrected with a '
  'compensating movement rather than an edit that destroys the evidence.';

comment on constraint stock_ledger_sign_matches_type on public.stock_ledger is
  'Binds the sign of qty_delta to txn_type. Without it a mis-signed ISSUE would '
  'silently inflate stock rather than fail.';

-- The reconciliation query: sum the ledger per balance key. Covered by the
-- composite index so a nightly check is an index-only scan.
create index stock_ledger_balance_key_idx
  on public.stock_ledger (tenant_id, location_id, product_id, batch_id);

-- The "what happened to this lot" question, which is the recall and audit query.
create index stock_ledger_batch_idx
  on public.stock_ledger (tenant_id, batch_id, occurred_at desc);

-- The "recent movements" feed, and the reverse-chronological index that serves it.
create index stock_ledger_recent_idx
  on public.stock_ledger (tenant_id, occurred_at desc);

-- ── immutability ────────────────────────────────────────────────────────────
--
-- Reuses the audit log's denier rather than writing a second one. The trigger
-- raises for every role including the table owner, which is deliberate: an
-- auditor with database access must not be able to rewrite stock history either.

create trigger stock_ledger_immutable
  before update or delete on public.stock_ledger
  for each row execute function private.deny_audit_mutation();

-- A ledger row's tenant, product, batch and location are all identity, not
-- editable state. The trigger above already blocks UPDATE outright, so this is
-- about a future partial-update policy being added by mistake.

create trigger stock_ledger_enforce_tenant
  before insert or update of tenant_id on public.stock_ledger
  for each row execute function private.assert_single_tenant();

create trigger stock_ledger_audit
  after insert on public.stock_ledger
  for each row execute function private.audit_row_change();

-- ── stock_balances ──────────────────────────────────────────────────────────

create table public.stock_balances (
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  location_id  uuid not null references public.storage_locations (id) on delete cascade,
  product_id   uuid not null references public.products (id) on delete cascade,
  batch_id     uuid not null references public.batches (id) on delete cascade,

  -- May legitimately be negative ONLY if the tenant opts in, which it cannot in
  -- M2. A balance below zero means the warehouse issued stock it did not have,
  -- so the invariant is enforced by the storage engine rather than by an
  -- application check that some future code path could skip.
  qty_on_hand  bigint not null default 0 check (qty_on_hand >= 0),

  -- Reserved but not yet issued. Written by M3 allocation; declared now because
  -- "available" is a derived quantity and the columns belong together.
  qty_reserved bigint not null default 0 check (qty_reserved >= 0),

  updated_at   timestamptz not null default now(),

  primary key (tenant_id, location_id, product_id, batch_id),

  -- Reserved cannot exceed what is on hand. Without this, an over-reservation
  -- would make "available" negative without tripping the check above.
  constraint stock_balances_reserved_within_on_hand check (qty_reserved <= qty_on_hand)
);

comment on table public.stock_balances is
  'Current stock position per location/product/batch. A materialisation of the '
  'ledger maintained by an AFTER INSERT trigger, not a second source of truth: '
  'there is no code path that writes a balance without a ledger row, so the two '
  'cannot drift.';

comment on constraint stock_balances_reserved_within_on_hand on public.stock_balances is
  'Reserved stock cannot exceed stock on hand, so the derived "available" '
  'quantity cannot go negative without this check noticing.';

-- ── the trigger that makes drift impossible ─────────────────────────────────
--
-- This is the whole reason the balance can be trusted. The trigger fires on EVERY
-- insert into the ledger, so:
--
--   - there is no way to record a movement without updating the balance
--   - there is no other writer of the balance (no client grant, and
--     post_stock_movement() does not touch it)
--
-- Hence "the balance disagrees with the ledger" is not a reachable state.
--
-- The upsert is a single statement so the row lock is taken once. Under
-- concurrency two movements to the same key serialise on this row, which is
-- correct: they are ordering-dependent by nature, and the ledger's order is the
-- order they were applied in.
--
-- SECURITY DEFINER because the trigger runs as the invoker (the authenticated
-- client) and the client holds no INSERT grant on the balance.

create or replace function private.apply_movement_to_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- UPDATE first, INSERT only if there was no row.
  --
  -- The obvious `insert ... on conflict do update` form is WRONG here, and
  -- silently so. Postgres evaluates a CHECK constraint against the candidate row
  -- BEFORE the ON CONFLICT arbiter decides to update instead, so
  -- `insert ... values (-40) on conflict do update set qty_on_hand =
  -- stock_balances.qty_on_hand + excluded.qty_on_hand` fails the
  -- qty_on_hand >= 0 check on the *insert candidate* even though the updated
  -- value would have been perfectly legal. Every outbound movement against an
  -- existing balance was refused; only the first receipt worked.
  --
  -- Order matters as much as the statement: an UPDATE checks the post-update
  -- value, which is the value we actually mean.
  update public.stock_balances
     set qty_on_hand = qty_on_hand + new.qty_delta,
         updated_at   = new.occurred_at
   where tenant_id   = new.tenant_id
     and location_id = new.location_id
     and product_id  = new.product_id
     and batch_id    = new.batch_id;

  if not found then
    -- First movement for this key, so create the row.
    begin
      insert into public.stock_balances (
        tenant_id, location_id, product_id, batch_id, qty_on_hand, qty_reserved, updated_at
      )
      values (
        new.tenant_id, new.location_id, new.product_id, new.batch_id,
        new.qty_delta, 0, new.occurred_at
      );
    exception
      when unique_violation then
        -- Two concurrent first-movements for the same key. The insert blocked on
        -- the primary key, lost, and the other transaction's row now exists. Apply
        -- the delta as an update instead. The subtransaction above has already
        -- rolled back cleanly, so the ledger insert is unaffected.
        update public.stock_balances
           set qty_on_hand = qty_on_hand + new.qty_delta,
               updated_at   = new.occurred_at
         where tenant_id   = new.tenant_id
           and location_id = new.location_id
           and product_id  = new.product_id
           and batch_id    = new.batch_id;
    end;
  end if;

  -- A balance driven below zero fails the table's CHECK and aborts the whole
  -- transaction, taking the ledger row with it. That is the intended behaviour:
  -- the movement is refused and nothing is recorded, rather than a negative
  -- balance existing to be discovered later.
  return new;
end;
$$;

comment on function private.apply_movement_to_balance() is
  'AFTER INSERT trigger on stock_ledger that maintains stock_balances. Exists so '
  'that a movement and its balance update are one event rather than two steps a '
  'function has to remember to perform in sequence.';

create trigger stock_ledger_apply_to_balance
  after insert on public.stock_ledger
  for each row execute function private.apply_movement_to_balance();

-- ── grants ──────────────────────────────────────────────────────────────────
--
-- No client WRITE access to either table. Reads are granted, and RLS is the gate
-- for them -- which is not a contradiction but the whole point of the model.
--
-- A SECURITY INVOKER view runs as the caller, so revoking SELECT outright does not
-- hide the tables, it breaks them: v_inventory_by_batch would fail with "permission
-- denied for table stock_balances" for every user. Granting SELECT and relying on
-- the tenant policy is the correct arrangement, and it is what makes a tenant's
-- own stock readable to its own staff, which they are entitled to see.
--
-- What must never be reachable is a WRITE. There is no INSERT, UPDATE or DELETE
-- grant here, so the only way to change a balance is a ledger row, and the only
-- way to produce a ledger row is private.post_stock_movement().

revoke all on table public.stock_ledger, public.stock_balances
  from anon, authenticated;

grant select on table public.stock_ledger, public.stock_balances to authenticated;
-- `anon` gets nothing at all: no session means no tenant, and there is no
-- anonymous read of stock.

-- ── RLS ─────────────────────────────────────────────────────────────────────
--
-- Enabled even though no client holds a grant. Belt and braces: RLS is the
-- backstop if a future migration grants something by accident, and the
-- rls_coverage suite asserts every public table has it, so removing these two
-- lines would fail the build.

alter table public.stock_ledger   enable row level security;
alter table public.stock_balances enable row level security;

-- Read policies are defined but unreachable from the client today. They exist so
-- that the moment a read grant is added -- for a view, or a report -- the tenant
-- scope is already correct rather than being the thing someone forgets.
create policy "read tenant stock ledger"
  on public.stock_ledger for select
  to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy "read tenant stock balances"
  on public.stock_balances for select
  to authenticated
  using (tenant_id = (select private.current_tenant_id()));
