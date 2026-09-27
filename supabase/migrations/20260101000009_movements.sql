-- ============================================================================
-- 0009_movements.sql
-- The only way stock changes: private.post_stock_movement() plus batch state
-- transitions, and thin api.* wrappers the client calls.
--
-- ERROR CONVENTION
--
-- Functions raise a stable error CODE as the message, with the parameters in
-- `detail` as JSON:
--
--   raise exception using errcode = 'P0001',
--                         message  = 'insufficient_stock',
--                         detail   = json_build_object('available', 12, 'requested', 40)::text;
--
-- The client maps the code to a localised string. This matters because the UI is
-- bilingual: an English sentence baked into a raise cannot be translated, and
-- parsing a human-readable message to recover a number is how a translated UI
-- ends up showing the wrong number. The code is the contract; the detail is the
-- data. `message` stays English for the logs, because that is who reads them.
--
-- The alternative -- raising "Not enough stock: 12 available, 40 requested" --
-- is untranslatable, unparseable, and untestable by anything but string matching.
-- ============================================================================

-- ── private.post_stock_movement ─────────────────────────────────────────────
--
-- The single writer of stock_ledger. It validates that the movement is legal and
-- inserts exactly one row; the AFTER INSERT trigger from 0008 maintains the
-- balance. Nothing in here writes a balance.

create or replace function private.post_stock_movement(
  p_location_id     uuid,
  p_product_id      uuid,
  p_batch_id        uuid,
  p_qty_delta       bigint,
  p_txn_type        private.movement_type,
  p_reference_type  text default null,
  p_reference_id    text default null,
  p_unit_cost_minor bigint default null,
  p_reason_code     text default null,
  p_notes           text default null,
  p_occurred_at     timestamptz default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant      uuid := private.current_tenant_id();
  v_facility    uuid;
  v_batch       public.batches%rowtype;
  v_product     uuid;
  v_ledger_id   bigint;
  v_available   bigint;
begin
  if v_tenant is null then
    raise exception using errcode = '42501',
      message = 'not_authenticated',
      detail  = json_build_object('hint', 'no tenant in session')::text;
  end if;

  if p_qty_delta = 0 then
    raise exception using errcode = 'P0001',
      message = 'zero_quantity_movement',
      detail  = json_build_object('txn_type', p_txn_type)::text;
  end if;

  -- Resolve the location, and prove it belongs to the caller's tenant. Doing this
  -- with a single lookup that includes the tenant predicate means a cross-tenant
  -- location id is simply not found, rather than found and then rejected -- there
  -- is no window in which its existence is disclosed.
  select l.facility_id into v_facility
  from public.storage_locations l
  where l.id = p_location_id
    and l.tenant_id = v_tenant
    and l.is_active
    and l.kind <> 'IN_TRANSIT';

  if v_facility is null then
    raise exception using errcode = 'P0001',
      message = 'location_not_found',
      detail  = json_build_object('location_id', p_location_id)::text;
  end if;

  -- Resolve the batch, and prove it matches the product. A batch from another
  -- product would otherwise let stock be recorded against a lot that does not
  -- contain that medicine, which is the kind of error that surfaces months later
  -- as an unrecallable recall.
  -- `b.*`, not a hand-listed column set. SELECT ... INTO a %rowtype assigns
  -- POSITIONALLY, so listing five columns against a twenty-column rowtype silently
  -- maps the third expression onto the third *column of the table* -- which made
  -- b.status ('RELEASED') land in product_id (uuid) and raise
  -- "invalid input syntax for type uuid: RELEASED". Selecting the whole row makes
  -- the assignment by name, so a column added later cannot shift the mapping.
  select b.*
    into v_batch
  from public.batches b
  where b.id = p_batch_id
    and b.tenant_id = v_tenant
    and b.deleted_at is null;

  if not found then
    raise exception using errcode = 'P0001',
      message = 'batch_not_found',
      detail  = json_build_object('batch_id', p_batch_id)::text;
  end if;

  if v_batch.product_id <> p_product_id then
    raise exception using errcode = 'P0001',
      message = 'batch_product_mismatch',
      detail  = json_build_object(
        'batch_id',   p_batch_id,
        'batch_product_id', v_batch.product_id,
        'given_product_id', p_product_id
      )::text;
  end if;

  v_product := p_product_id;

  -- A movement is only ever rejected for a batch that is unavailable, and only
  -- when it would be an outbound movement. Receiving INTO quarantine is exactly
  -- how goods enter the system, so the check is scoped to the sign rather than
  -- applied unconditionally.
  if p_qty_delta < 0 and v_batch.status <> 'RELEASED' then
    raise exception using errcode = 'P0001',
      message = 'batch_not_released',
      detail  = json_build_object(
        'batch_id',  p_batch_id,
        'lot_number', (select b.lot_number from public.batches b where b.id = p_batch_id),
        'status',    v_batch.status
      )::text;
  end if;

  -- Expired stock may be written off or adjusted but never issued, even if the
  -- status has not been swept to EXPIRED yet. Without this, a batch whose expiry
  -- passed overnight is still RELEASED and would be allocatable until a nightly
  -- job noticed.
  if p_qty_delta < 0 and v_batch.expiry_date <= current_date then
    raise exception using errcode = 'P0001',
      message = 'batch_expired',
      detail  = json_build_object(
        'batch_id',   p_batch_id,
        'expiry_date', v_batch.expiry_date,
        'today',       current_date
      )::text;
  end if;

  -- ADJUSTMENT is the one type that carries no inherent direction, so nothing
  -- about it says what it was for. A reason code is what makes an unexplained
  -- difference in stock explicable six months later.
  if p_txn_type = 'ADJUSTMENT' and (p_reason_code is null or btrim(p_reason_code) = '') then
    raise exception using errcode = 'P0001',
      message = 'reason_code_required',
      detail  = json_build_object('txn_type', p_txn_type)::text;
  end if;

  -- The available amount, for a clear error message rather than a bare constraint
  -- violation. A CHECK failure says "violates check constraint"; this says
  -- "12 available, 40 requested", which is the sentence a warehouse manager
  -- needs.
  if p_qty_delta < 0 then
    select coalesce(b.qty_on_hand, 0) - coalesce(b.qty_reserved, 0) into v_available
    from public.stock_balances b
    where b.tenant_id   = v_tenant
      and b.location_id = p_location_id
      and b.product_id  = v_product
      and b.batch_id    = p_batch_id;

    v_available := coalesce(v_available, 0);

    if v_available + p_qty_delta < 0 then
      raise exception using errcode = 'P0001',
        message = 'insufficient_stock',
        detail  = json_build_object(
          'available',   v_available,
          'requested',   -p_qty_delta,
          'batch_id',    p_batch_id,
          'location_id', p_location_id
        )::text;
    end if;
  end if;

  insert into public.stock_ledger (
    tenant_id, facility_id, location_id, product_id, batch_id,
    qty_delta, txn_type, reference_type, reference_id,
    unit_cost_minor, reason_code, notes, actor_user_id, occurred_at
  )
  values (
    v_tenant, v_facility, p_location_id, v_product, p_batch_id,
    p_qty_delta, p_txn_type, p_reference_type, p_reference_id,
    p_unit_cost_minor, p_reason_code, p_notes, (select auth.uid()),
    coalesce(p_occurred_at, now())
  )
  returning id into v_ledger_id;

  -- A DEPLETED batch is finished business, and marking it here means a nightly
  -- sweep is not needed to keep the catalogue honest.
  --
  -- Only for movements that genuinely CONSUME. A transfer is excluded, and the
  -- exclusion is load-bearing: move_stock() posts the outbound row first, so for
  -- the instant between the two rows the batch holds nothing anywhere. Without
  -- this guard a transfer permanently marked its batch DEPLETED -- the stock then
  -- arrived at the destination while the status stayed DEPLETED, and no later
  -- release of that batch was possible because DEPLETED -> RELEASED is not a legal
  -- transition. Stock had moved; nothing had been consumed.
  if p_qty_delta < 0
     and p_txn_type in ('ISSUE', 'DISPENSE', 'WRITE_OFF', 'COUNT_LOSS', 'RECALL_QUARANTINE') then
    update public.batches b
       set status = 'DEPLETED'
     where b.id = p_batch_id
       and b.status = 'RELEASED'
       and not exists (
         select 1 from public.stock_balances sb
         where sb.tenant_id = v_tenant
           and sb.batch_id = p_batch_id
           and sb.qty_on_hand - sb.qty_reserved > 0
       );
  end if;

  return v_ledger_id;
end;
$$;

comment on function private.post_stock_movement is
  'The only writer of stock_ledger. Validates the movement, inserts one row, and '
  'lets the 0008 trigger maintain the balance. Raises stable error codes with '
  'JSON detail so the client can localise the message.';

-- ── batch state transitions ─────────────────────────────────────────────────
--
-- One function rather than four. The legal-transition table lives in one place,
-- which is the only way "which transitions are allowed" stays answerable.

create or replace function private.transition_batch(
  p_batch_id uuid,
  p_to_status private.batch_status,
  p_reason    text,
  p_allow_expired boolean default false
)
returns public.batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_batch  public.batches%rowtype;
  v_allowed boolean := false;
begin
  if v_tenant is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select * into v_batch
  from public.batches b
  where b.id = p_batch_id and b.tenant_id = v_tenant and b.deleted_at is null;

  if not found then
    raise exception using errcode = 'P0001',
      message = 'batch_not_found',
      detail  = json_build_object('batch_id', p_batch_id)::text;
  end if;

  if p_to_status = 'RECALLED' and (p_reason is null or btrim(p_reason) = '') then
    raise exception using errcode = 'P0001',
      message = 'recall_reason_required',
      detail  = json_build_object('batch_id', p_batch_id)::text;
  end if;

  -- The transition table. Written as explicit pairs rather than a regex on the
  -- enum name so that an unlisted transition is refused by default rather than
  -- accidentally allowed by a pattern.
  v_allowed := case
    when v_batch.status = p_to_status              then true   -- idempotent
    when v_batch.status = 'QUARANTINED' and p_to_status = 'RELEASED'  then true
    when v_batch.status = 'RELEASED'    and p_to_status = 'QUARANTINED' then true
    when v_batch.status = 'RELEASED'    and p_to_status = 'RECALLED'   then true
    when v_batch.status = 'QUARANTINED' and p_to_status = 'RECALLED'   then true
    when v_batch.status = 'RECALLED'    and p_to_status = 'QUARANTINED' then true
    when v_batch.status = 'EXPIRED'     and p_to_status = 'QUARANTINED' then true
    else false
  end;

  -- A recalled lot may only return through quarantine, never straight to
  -- RELEASED. Skipping the quarantine step on a recall release would put
  -- questionable stock back into circulation with no inspection recorded, which is
  -- precisely what the recall was meant to prevent.
  if v_batch.status = 'RECALLED' and p_to_status = 'RELEASED' then
    v_allowed := false;
  end if;

  if not v_allowed then
    raise exception using errcode = 'P0001',
      message = 'illegal_batch_transition',
      detail  = json_build_object(
        'batch_id',   p_batch_id,
        'from',       v_batch.status,
        'to',         p_to_status
      )::text;
  end if;

  -- Expired stock must not be released back into circulation. The status may be
  -- set for reporting, but RELEASED would make it allocatable by FEFO.
  if p_to_status = 'RELEASED'
     and not p_allow_expired
     and v_batch.expiry_date <= current_date then
    raise exception using errcode = 'P0001',
      message = 'cannot_release_expired_batch',
      detail  = json_build_object(
        'batch_id',    p_batch_id,
        'expiry_date', v_batch.expiry_date,
        'today',       current_date
      )::text;
  end if;

  -- A recall must MOVE the stock, not just change a label. Leaving the quantity
  -- where it is and trusting FEFO to skip the batch is one missed filter away from
  -- shipping something a regulator has withdrawn.
  --
  -- The move happens BEFORE the status is updated, and that order is load-bearing.
  -- post_stock_movement() refuses an outbound movement from a batch that is not
  -- RELEASED, so quarantining after the status became RECALLED would raise
  -- batch_not_released and the recall would fail with stock still sitting in a
  -- sellable location. Moving first means the batch is still RELEASED while its
  -- stock is being relocated.
  --
  -- If the move fails -- no quarantine location, insufficient stock -- the whole
  -- transaction rolls back and the status is untouched. A recall that cannot secure
  -- the stock should fail loudly rather than half-apply.
  if p_to_status = 'RECALLED' then
    perform private.quarantine_stock_of_batch(p_batch_id, p_reason);
  end if;

  update public.batches b
     set status             = p_to_status,
         status_reason      = p_reason,
         status_changed_at  = now(),
         status_changed_by  = (select auth.uid()),
         released_at        = case when p_to_status = 'RELEASED' then now() else b.released_at end,
         released_by        = case when p_to_status = 'RELEASED' then (select auth.uid()) else b.released_by end
   where b.id = p_batch_id
  returning * into v_batch;

  return v_batch;
end;
$$;

-- ── moving stock between locations ──────────────────────────────────────────
--
-- A move is TWO ledger rows, not one. A recall has to take stock out of wherever
-- it is and put it into quarantine; posting a single negative movement at the
-- quarantine location fails with insufficient_stock, because quarantine holds
-- nothing and the source is not the location named in the call.
--
-- Two rows is also the honest model. The ledger records movements, and a transfer
-- genuinely is two of them. A shared reference_id ties the pair together so they
-- can be found as one logical event, and because one is negative and one positive
-- the total is conserved -- which is the property the smoke test asserts.
--
-- Both rows are in one transaction, so a transfer can never half-apply.

create or replace function private.move_stock(
  p_from_location uuid,
  p_to_location   uuid,
  p_product_id    uuid,
  p_batch_id      uuid,
  p_qty           bigint,
  p_reason_code   text,
  p_txn_out       private.movement_type default 'TRANSFER_OUT',
  p_txn_in        private.movement_type default 'TRANSFER_IN',
  p_notes         text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference text := gen_random_uuid()::text;
begin
  if p_qty <= 0 then
    raise exception using errcode = 'P0001',
      message = 'quantity_must_be_positive',
      detail  = json_build_object('qty', p_qty)::text;
  end if;

  if p_from_location = p_to_location then
    raise exception using errcode = 'P0001',
      message = 'same_location_transfer',
      detail  = json_build_object('location_id', p_from_location)::text;
  end if;

  -- Out first, so an insufficient-stock refusal happens before anything is
  -- created at the destination. If the second row then fails, the first rolls back
  -- with it.
  perform private.post_stock_movement(
    p_location_id  => p_from_location,
    p_product_id   => p_product_id,
    p_batch_id     => p_batch_id,
    p_qty_delta    => -p_qty,
    p_txn_type     => p_txn_out,
    p_reference_type => 'transfer',
    p_reference_id => v_reference,
    p_reason_code  => p_reason_code,
    p_notes        => p_notes
  );

  perform private.post_stock_movement(
    p_location_id  => p_to_location,
    p_product_id   => p_product_id,
    p_batch_id     => p_batch_id,
    p_qty_delta    => p_qty,
    p_txn_type     => p_txn_in,
    p_reference_type => 'transfer',
    p_reference_id => v_reference,
    p_reason_code  => p_reason_code,
    p_notes        => p_notes
  );

  -- Belt and braces against the transient-empty window. The guard in
  -- post_stock_movement already excludes transfers from DEPLETED marking, but a
  -- batch that was genuinely empty before a transfer in is now not, and if some
  -- other path ever marked it DEPLETED the stock would be sitting in a location
  -- that FEFO refuses to allocate. Cheap to be certain.
  update public.batches b
     set status = 'RELEASED'
   where b.id = p_batch_id
     and b.status = 'DEPLETED'
     and exists (
       select 1 from public.stock_balances sb
       where sb.tenant_id = private.current_tenant_id()
         and sb.batch_id = p_batch_id
         and sb.qty_on_hand - sb.qty_reserved > 0
     );

  return 0;
end;
$$;

comment on function private.move_stock is
  'Moves quantity between two locations as a matched pair of ledger rows sharing a '
  'reference_id. One row cannot express a move: a negative movement is scoped to '
  'the location it leaves, so posting it at the destination reads the wrong '
  'balance and refuses with insufficient_stock.';

-- Moves every balance of a batch into the tenant's quarantine location, recording
-- RECALL_QUARANTINE movements so the ledger shows where the stock went.
--
-- Separate from transition_batch because a batch can hold stock in several
-- locations at once and each needs its own move.
create or replace function private.quarantine_stock_of_batch(
  p_batch_id uuid,
  p_reason   text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant  uuid := private.current_tenant_id();
  v_quarantine uuid;
  v_row     record;
  v_count   integer := 0;
begin
  -- The tenant's quarantine location. A tenant with more than one needs a
  -- deterministic choice, so the lowest code wins rather than an arbitrary row.
  select l.id into v_quarantine
  from public.storage_locations l
  where l.tenant_id = v_tenant and l.kind = 'QUARANTINE' and l.is_active
  order by l.code
  limit 1;

  if v_quarantine is null then
    raise exception using errcode = 'P0001',
      message = 'no_quarantine_location',
      detail  = json_build_object('hint', 'create a QUARANTINE location first')::text;
  end if;

  -- Collected first, then moved. Iterating and mutating the same query's source
  -- table is how a cursor ends up re-reading rows it has just changed.
  for v_row in
    select sb.location_id, sb.product_id, (sb.qty_on_hand - sb.qty_reserved) as qty
    from public.stock_balances sb
    where sb.tenant_id = v_tenant
      and sb.batch_id = p_batch_id
      and sb.location_id <> v_quarantine
      and sb.qty_on_hand - sb.qty_reserved > 0
    order by sb.location_id
    for update of sb
  loop
    perform private.move_stock(
      p_from_location => v_row.location_id,
      p_to_location   => v_quarantine,
      p_product_id    => v_row.product_id,
      p_batch_id      => p_batch_id,
      p_qty           => v_row.qty,
      p_reason_code   => 'recall',
      p_txn_out       => 'RECALL_QUARANTINE',
      p_txn_in        => 'RECALL_RELEASE',
      p_notes         => p_reason
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function private.quarantine_stock_of_batch is
  'Relocates every balance of a batch into the tenant''s quarantine location, one '
  'matched pair of ledger rows per source location. Selecting the balances before '
  'moving them avoids iterating a cursor over a table the loop is mutating.';

comment on function private.transition_batch is
  'The only path to a batch status change. The legal-transition table is explicit '
  'pairs rather than a pattern, so an unlisted transition is refused by default. '
  'A recalled batch may only return through QUARANTINED, never straight to '
  'RELEASED, and expired stock is never released.';

-- ── api wrappers ────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER, and this is load-bearing rather than convenient.
--
-- `private` carries no USAGE grant to client roles -- that is what the schema
-- split is -- so an INVOKER wrapper cannot call private.* at all. It dies with
-- "permission denied for schema private" before reaching any logic. A wrapper that
-- mutates stock therefore has to be DEFINER to reach the validation, which makes
-- the wrapper itself the security boundary.
--
-- Every one of them therefore does its own authorisation, in this order:
--   1. private.require_inventory_write()  -- role check, refusing a non-warehouse role
--   2. private.current_tenant_id()        -- scope, resolved from the session
--   3. the private implementation, which re-checks the tenant on every row it touches
--
-- A future function added to this file must do the same. Copying the pattern is
-- the point; skipping step 1 is a privilege escalation.

-- ── batch state wrappers ────────────────────────────────────────────────────

create or replace function private.require_inventory_write(p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_write_inventory() then
    raise exception using errcode = '42501',
      message = 'insufficient_role',
      detail  = json_build_object(
        'action',   p_action,
        'required', 'TENANT_ADMIN or WAREHOUSE_MANAGER',
        'actual',   private.current_role()
      )::text;
  end if;
end;
$$;

comment on function private.require_inventory_write is
  'Refuses a stock or batch mutation from a role that may not perform one. Called '
  'at the top of every api.* wrapper so the refusal is uniform and the message '
  'names both the required and the actual role.';

create or replace function api.release_batch(
  p_batch_id uuid,
  p_reason   text default null
)
returns public.batches
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_inventory_write('release_batch');
  return private.transition_batch(p_batch_id, 'RELEASED', p_reason);
end;
$$;

create or replace function api.quarantine_batch(
  p_batch_id uuid,
  p_reason   text
)
returns public.batches
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_inventory_write('quarantine_batch');
  if p_reason is null or btrim(p_reason) = '' then
    raise exception using errcode = 'P0001',
      message = 'quarantine_reason_required',
      detail  = json_build_object('batch_id', p_batch_id)::text;
  end if;
  return private.transition_batch(p_batch_id, 'QUARANTINED', p_reason);
end;
$$;

create or replace function api.recall_batch(
  p_batch_id uuid,
  p_reason   text
)
returns public.batches
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_inventory_write('recall_batch');
  return private.transition_batch(p_batch_id, 'RECALLED', p_reason);
end;
$$;

-- ── movement wrappers ───────────────────────────────────────────────────────

create or replace function api.receive_stock(
  p_location_id     uuid,
  p_product_id      uuid,
  p_batch_id        uuid,
  p_qty             bigint,
  p_unit_cost_minor bigint default null,
  p_supplier_ref    text default null,
  p_notes           text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_inventory_write('receive_stock');
  return private.post_stock_movement(
    p_location_id     => p_location_id,
    p_product_id      => p_product_id,
    p_batch_id        => p_batch_id,
    p_qty_delta       => p_qty,
    p_txn_type        => 'RECEIPT',
    p_reference_type  => 'purchase_receipt',
    p_reference_id    => p_supplier_ref,
    p_unit_cost_minor => p_unit_cost_minor,
    p_notes           => p_notes
  );
end;
$$;

comment on function api.receive_stock is
  'Goods in from a supplier. qty is positive; the sign rule on the ledger binds it '
  'to RECEIPT. Receiving into a QUARANTINE location is the normal path, since '
  'nothing is available for supply until it is released.';

create or replace function api.issue_stock(
  p_location_id     uuid,
  p_product_id      uuid,
  p_batch_id        uuid,
  p_qty             bigint,
  p_reference_type  text default null,
  p_reference_id    text default null,
  p_notes           text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_inventory_write('issue_stock');
  if p_qty <= 0 then
    raise exception using errcode = 'P0001',
      message = 'quantity_must_be_positive',
      detail  = json_build_object('qty', p_qty)::text;
  end if;

  return private.post_stock_movement(
    p_location_id    => p_location_id,
    p_product_id     => p_product_id,
    p_batch_id       => p_batch_id,
    p_qty_delta      => -p_qty,
    p_txn_type       => 'ISSUE',
    p_reference_type => p_reference_type,
    p_reference_id   => p_reference_id,
    p_notes          => p_notes
  );
end;
$$;

create or replace function api.adjust_stock(
  p_location_id uuid,
  p_product_id  uuid,
  p_batch_id    uuid,
  p_qty_delta   bigint,
  p_reason_code text,
  p_notes       text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_inventory_write('adjust_stock');
  return private.post_stock_movement(
    p_location_id  => p_location_id,
    p_product_id   => p_product_id,
    p_batch_id     => p_batch_id,
    p_qty_delta    => p_qty_delta,
    p_txn_type     => 'ADJUSTMENT',
    p_reason_code  => p_reason_code,
    p_notes        => p_notes
  );
end;
$$;

comment on function api.adjust_stock is
  'Manual correction in either direction. p_reason_code is mandatory: an '
  'unexplained difference in stock is not a correction, it is a hole.';

create or replace function api.write_off_stock(
  p_location_id uuid,
  p_product_id  uuid,
  p_batch_id    uuid,
  p_qty         bigint,
  p_reason_code text,
  p_notes       text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_inventory_write('write_off_stock');
  if p_reason_code is null or btrim(p_reason_code) = '' then
    raise exception using errcode = 'P0001',
      message = 'reason_code_required',
      detail  = json_build_object('action', 'write_off_stock')::text;
  end if;
  return private.post_stock_movement(
    p_location_id  => p_location_id,
    p_product_id   => p_product_id,
    p_batch_id     => p_batch_id,
    p_qty_delta    => -abs(p_qty),
    p_txn_type     => 'WRITE_OFF',
    p_reason_code  => p_reason_code,
    p_notes        => p_notes
  );
end;
$$;

create or replace function api.transfer_stock(
  p_from_location uuid,
  p_to_location   uuid,
  p_product_id    uuid,
  p_batch_id      uuid,
  p_qty           bigint,
  p_reason_code   text default null,
  p_notes         text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_inventory_write('transfer_stock');
  return private.move_stock(
    p_from_location => p_from_location,
    p_to_location   => p_to_location,
    p_product_id    => p_product_id,
    p_batch_id      => p_batch_id,
    p_qty           => p_qty,
    p_reason_code   => p_reason_code,
    p_notes         => p_notes
  );
end;
$$;

comment on function api.transfer_stock is
  'Moves stock between two locations, e.g. ambient to cold store. Recorded as two '
  'ledger rows sharing a reference, so the total is conserved and the move is '
  'visible as one event.';

-- ── batch creation ──────────────────────────────────────────────────────────

create or replace function api.create_batch(
  p_product_id      uuid,
  p_lot_number      text,
  p_mfg_date        date,
  p_expiry_date     date,
  p_unit_cost_minor bigint default 0,
  p_supplier_name   text default null,
  p_supplier_ref    text default null,
  p_release_now     boolean default false
)
returns public.batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_batch  public.batches;
begin
  perform private.require_inventory_write('create_batch');

  if v_tenant is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  if p_lot_number is null or btrim(p_lot_number) = '' then
    raise exception using errcode = 'P0001', message = 'lot_number_required';
  end if;

  if p_expiry_date <= p_mfg_date then
    raise exception using errcode = 'P0001',
      message = 'invalid_expiry_date',
      detail  = json_build_object(
        'mfg_date',    p_mfg_date,
        'expiry_date', p_expiry_date
      )::text;
  end if;

  -- The unique index would reject a duplicate lot for this product, but a
  -- constraint violation is a poor message. Checked explicitly so the client can
  -- say "lot LOT-1 already exists for this product".
  if exists (
    select 1 from public.batches b
    where b.tenant_id = v_tenant
      and b.product_id = p_product_id
      and lower(btrim(b.lot_number)) = lower(btrim(p_lot_number))
      and b.deleted_at is null
  ) then
    raise exception using errcode = 'P0001',
      message = 'duplicate_lot_number',
      detail  = json_build_object(
        'lot_number', p_lot_number,
        'product_id', p_product_id
      )::text;
  end if;

  insert into public.batches (
    tenant_id, product_id, lot_number, mfg_date, expiry_date,
    unit_cost_minor, supplier_name, supplier_ref, status
  )
  values (
    v_tenant, p_product_id, btrim(p_lot_number), p_mfg_date, p_expiry_date,
    p_unit_cost_minor, p_supplier_name, p_supplier_ref,
    case when p_release_now then 'RELEASED'::private.batch_status
         else 'QUARANTINED'::private.batch_status end
  )
  returning * into v_batch;

  if p_release_now then
    v_batch := private.transition_batch(v_batch.id, 'RELEASED', 'released on receipt');
  end if;

  return v_batch;
end;
$$;

-- ── grants ──────────────────────────────────────────────────────────────────
--
-- Explicit per function. New functions in `api` are not callable until added
-- here, which is the safe default for a schema that holds privileged operations.

revoke all on all functions in schema api from public;
grant execute on all functions in schema api to authenticated;
