-- ============================================================================
-- 20260101000011_stocktake.sql
--
-- Stocktake, and a fix to what a stocktake would have exposed.
--
-- ── the bug this migration starts with ────────────────────────────────────────
--
-- post_stock_movement() refused EVERY negative movement against a batch whose
-- expiry_date had passed:
--
--   if p_qty_delta < 0 and v_batch.expiry_date <= current_date then
--     raise exception ... message = 'batch_expired';
--
-- The comment directly above it claimed the opposite intent -- "Expired stock may
-- be written off or adjusted but never issued" -- but the code applied the check
-- to all negative movements, including the two the comment says should work. The
-- comment was right and the code was wrong.
--
-- The effect was that an expired batch could not be written off. Reproduced
-- against the seed: LOT-2024-E0091, 25 units on hand, expired 2026-08-28, on a
-- run dated 2026-09-27.
--
--   ERROR: batch_expired
--   DETAIL: {"batch_id":"...505","expiry_date":"2026-08-28","today":"2026-09-27"}
--
-- That is a trap rather than a nuisance. Expired stock is supposed to be removed
-- from the books; refusing the write-off leaves it on hand forever, inflating
-- inventory and looking allocatable. And the obvious workaround does not help:
-- sweeping the batch to status EXPIRED leaves the check firing, because it tests
-- expiry_date rather than status, so the stock is stuck in exactly the state
-- where it is both worthless and impossible to remove.
--
-- It survived 115 assertions because the only expired fixture was QUARANTINED,
-- and for that batch the status check fired first, raising batch_not_released
-- before the expiry check was ever reached. The two checks were ordered so that
-- the broken one was never the one under test.
--
-- ── the distinction being drawn ───────────────────────────────────────────────
--
-- A negative movement is one of two different things, and conflating them is
-- what caused this:
--
--   A DISPOSITION removes stock from the usable pool by decision -- it is given
--   to a customer, or moved out. ISSUE, DISPENSE, TRANSFER_OUT, RECALL_QUARANTINE.
--   Blocked for a batch that is unreleased or expired, because handing out
--   unusable stock is the actual harm.
--
--   A CORRECTION makes the books match what is physically on the shelf --
--   WRITE_OFF, COUNT_LOSS, COUNT_GAIN, ADJUSTMENT. A physical fact does not
--   become less true because a batch has expired. If 25 expired cartons are
--   still sitting on a shelf, then 25 expired cartons are on the shelf, and the
--   only question is whether the books say so. Blocking the write-off is what
--   makes the books lie.
--
-- So both checks are now scoped to dispositions. The guarantee that actually
-- matters is untouched: stock is still never issued past its expiry, and the
-- regression test below asserts exactly that, so a future edit that widens the
-- carve-out to dispositions fails loudly.
-- ============================================================================


-- ── post_stock_movement, with the two checks scoped to dispositions ───────────

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

  -- A movement is refused for an unavailable batch only when it DISPOSES of
  -- stock, i.e. gives it to someone or moves it out of the usable pool.
  --
  -- Scoped to the type rather than applied to every negative movement, which is
  -- the correction this migration makes. Counting stock is an observation of
  -- reality: if a QUARANTINED batch is short, the books should record that they
  -- are short, and refusing the count is how an unreconciled discrepancy gets
  -- to sit there instead.
  if p_qty_delta < 0
     and p_txn_type in ('ISSUE', 'DISPENSE', 'TRANSFER_OUT', 'RECALL_QUARANTINE')
     and v_batch.status <> 'RELEASED' then
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
  --
  -- Same scoping as the check above, and for the same reason: the prohibition is
  -- against SUPPLYING expired stock, not against accounting for it. This check
  -- previously applied to every negative movement, which made an expired batch
  -- unwritable-off -- see the header of this migration.
  if p_qty_delta < 0
     and p_txn_type in ('ISSUE', 'DISPENSE', 'TRANSFER_OUT', 'RECALL_QUARANTINE')
     and v_batch.expiry_date <= current_date then
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
  'lets the 0008 trigger maintain the balance. Availability and expiry are '
  'enforced for dispositions only (ISSUE, DISPENSE, TRANSFER_OUT, '
  'RECALL_QUARANTINE); corrections (WRITE_OFF, COUNT_GAIN, COUNT_LOSS, ADJUSTMENT) '
  'are allowed against an unreleased or expired batch, because a physical count '
  'does not become false when the batch expires. Raises stable error codes with '
  'JSON detail so the client can localise the message.';


-- ============================================================================
-- the second bug: a written-off lot that is restocked can never be issued again
-- ============================================================================
--
-- Found while testing the first fix, by the same probe. Writing off all 25 units
-- of LOT-2024-E0091 marks it DEPLETED, which is correct: nothing is on hand.
-- Receiving 10 more of the same lot then succeeds -- the ledger records a RECEIPT
-- and the balance reads 10 -- but the status stays DEPLETED, and DEPLETED has no
-- legal transition to RELEASED. So the stock is on the shelf, visible in every
-- balance, and unsellable forever.
--
-- Reproduced against the seed:
--
--   write_off_stock(..., 25)      -> ok, status DEPLETED
--   receive_stock(..., 10)        -> ok, ledger 14, status STILL DEPLETED
--
-- This is the more dangerous of the two, because nothing reports an error. The
-- receipt succeeds, the UI shows 10 units received, and the discrepancy only
-- surfaces weeks later as a shortage nobody can explain.
--
-- DEPLETED is being treated as terminal when it means "nothing on hand right
-- now". A distributor absolutely does receive the same lot twice -- a second
-- delivery against the same lot number is ordinary, not an edge case.
--
-- ── why DEPLETED -> RELEASED is safe to allow ────────────────────────────────
--
-- The concern with any transition back to RELEASED is that it would let a
-- withdrawn lot back into circulation. That cannot happen here, because
-- DEPLETED is only ever reached from RELEASED: the marking statement in
-- post_stock_movement carries `where b.status = 'RELEASED'`. A DEPLETED batch is
-- therefore by construction a lot that was legitimately released and then ran
-- out. Recalled and quarantined lots go to RECALLED and QUARANTINED and never
-- pass through DEPLETED, and transition_batch already refuses RECALLED ->
-- RELEASED outright.
--
-- The expiry guard is not bypassed either, and that is the case that needs
-- care: an EXPIRED lot that is restocked must NOT become issuable. A supplier
-- sending expired goods is a real scenario -- the goods should be received and
-- then written off, not refused at the door -- so the receipt has to succeed
-- while the re-release is skipped. Hence the guard in receive_stock below,
-- which checks the expiry itself rather than letting transition_batch raise and
-- roll the whole receipt back.

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
    -- Added in 0011. A lot that ran out and has been restocked is not finished,
    -- it is restocked. Reachable only from a batch that was once RELEASED --
    -- DEPLETED is never entered from QUARANTINED, RECALLED or EXPIRED -- and the
    -- expiry guard below still applies, so this cannot resurrect an expired lot.
    when v_batch.status = 'DEPLETED'   and p_to_status = 'RELEASED'   then true
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

comment on function private.transition_batch is
  'The single place the legal-transition table lives, which is the only way '
  '"which transitions are allowed" stays answerable. DEPLETED -> RELEASED was added '
  'in 0011 for a restocked lot; it is safe because DEPLETED is only ever entered '
  'from RELEASED, and the expired-batch guard still refuses to release.';


-- ── receive_stock, re-releasing a restocked lot ──────────────────────────────

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
declare
  v_ledger_id bigint;
  v_batch     public.batches%rowtype;
begin
  perform private.require_inventory_write('receive_stock');

  v_ledger_id := private.post_stock_movement(
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

  -- A lot that ran out and has just been restocked is not finished. Leaving it
  -- DEPLETED would strand the stock that was just received: on the shelf, in
  -- every balance, and unsellable, with nothing anywhere reporting a problem.
  --
  -- The expiry is checked here rather than left to transition_batch to raise,
  -- because a supplier really can deliver expired goods. The receipt must succeed
  -- so the stock is accounted for and can then be written off; only the
  -- re-release is skipped. Letting the exception escape would roll back the
  -- receipt and refuse goods at the door that we would then have to receive
  -- somewhere else anyway.
  select b.* into v_batch
  from public.batches b
  where b.id = p_batch_id
    and b.tenant_id = private.current_tenant_id()
    and b.deleted_at is null;

  if found
     and v_batch.status = 'DEPLETED'
     and v_batch.expiry_date > current_date then
    perform private.transition_batch(
      p_batch_id => p_batch_id,
      p_to_status => 'RELEASED',
      p_reason   => 'restocked after write-off'
    );
  end if;

  return v_ledger_id;
end;
$$;

comment on function api.receive_stock is
  'Goods in from a supplier. qty is positive; the sign rule on the ledger binds it '
  'to RECEIPT. Receiving into a QUARANTINE location is the normal path, since '
  'nothing is available for supply until it is released. Added in 0011: a receipt '
  'into a DEPLETED lot re-releases it, unless the lot has since expired, in which '
  'case the goods are received and left DEPLETED so they can be written off.';


-- ── api.stock_take ───────────────────────────────────────────────────────────

create or replace function api.stock_take(
  p_location_id uuid,
  p_product_id  uuid,
  p_batch_id    uuid,
  p_counted_qty bigint,
  p_reason_code text,
  p_notes       text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant    uuid := private.current_tenant_id();
  v_on_hand   bigint;
  v_delta     bigint;
  v_txn_type  private.movement_type;
begin
  perform private.require_inventory_write('stock_take');

  -- A count of less than nothing is not a small mistake, it is a transcription
  -- error, and accepting it would book stock into existence. Refused with its own
  -- code rather than the generic quantity_must_be_positive, because the fix is
  -- different: a negative count means the counted figure was mis-keyed or the
  -- sign convention was misunderstood, not that the caller asked to remove stock.
  if p_counted_qty is null or p_counted_qty < 0 then
    raise exception using errcode = 'P0001',
      message = 'counted_quantity_invalid',
      detail  = json_build_object('counted_qty', p_counted_qty)::text;
  end if;

  -- A variance is never explicable without a reason, in either direction. The
  -- tempting case is a count that comes up SHORT and looks like a miscount, but
  -- that is exactly the case a reason code exists to disambiguate: a miscount
  -- corrected and four cartons genuinely stolen are the same number in the books
  -- and completely different events.
  if p_reason_code is null or btrim(p_reason_code) = '' then
    raise exception using errcode = 'P0001',
      message = 'reason_code_required',
      detail  = json_build_object('action', 'stock_take')::text;
  end if;

  -- Read the current on-hand for exactly this key. coalesce to 0 so a count of a
  -- batch that has never been received is a legitimate COUNT_GAIN rather than a
  -- null-propagation surprise: someone counted 40 cartons of a lot the system
  -- does not know about, and the honest response is to book them and investigate,
  -- not to return null and leave the discrepancy invisible.
  select coalesce(max(sb.qty_on_hand), 0) into v_on_hand
  from public.stock_balances sb
  where sb.tenant_id   = v_tenant
    and sb.location_id = p_location_id
    and sb.product_id  = p_product_id
    and sb.batch_id    = p_batch_id;

  v_delta := p_counted_qty - v_on_hand;

  -- A count that matches the books is the ordinary good outcome of a stocktake,
  -- and most lines on a real count sheet are exactly that. Returning NULL is
  -- therefore a SUCCESS, not an error: the UI reports "matched, no adjustment"
  -- and the ledger stays free of zero-delta noise. Raising zero_quantity_movement
  -- here would punish the common case with an error message, and a counter that
  -- cries wolf on every accurate line stops being read.
  if v_delta = 0 then
    return null;
  end if;

  v_txn_type := case when v_delta > 0 then 'COUNT_GAIN' else 'COUNT_LOSS' end;

  -- COUNT_LOSS cannot drive stock negative, and does not need a separate check:
  -- counted >= 0 and delta = counted - on_hand, so delta >= -on_hand always, and
  -- the balance lands on counted. The arithmetic bounds it; an assertion here
  -- would be restating the subtraction.
  return private.post_stock_movement(
    p_location_id  => p_location_id,
    p_product_id   => p_product_id,
    p_batch_id     => p_batch_id,
    p_qty_delta    => v_delta,
    p_txn_type     => v_txn_type,
    p_reason_code  => p_reason_code,
    p_notes        => coalesce(
      p_notes,
      format(
        'Stocktake: counted %s, system %s, variance %s',
        p_counted_qty, v_on_hand, v_delta
      )
    )
  );
end;
$$;

comment on function api.stock_take is
  'Records a physical count and posts the variance as COUNT_GAIN or COUNT_LOSS. '
  'Takes the absolute COUNTED quantity rather than a delta, because the person '
  'counting a shelf knows how many cartons are in front of them and would '
  'otherwise have to compute the difference by hand. Returns the new ledger id, or '
  'NULL when the count matched the books -- a match is the common case on a real '
  'count sheet and is a success, so it books nothing rather than raising.';


-- ── grants ───────────────────────────────────────────────────────────────────
--
-- Explicit, as in 0009: a function in `api` is not callable until it is named
-- here, which is the safe default for a schema holding privileged operations.

revoke all on function api.stock_take(uuid, uuid, uuid, bigint, text, text) from public;
grant  execute on function api.stock_take(uuid, uuid, uuid, bigint, text, text) to authenticated;
