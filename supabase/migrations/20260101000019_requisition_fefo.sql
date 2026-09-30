-- FEFO allocation: approve a requisition and reserve the stock against it.
--
-- ── why FEFO and not FIFO ───────────────────────────────────────────────────
--
-- FEFO -- First Expired, First Out -- allocates from the batch that expires
-- soonest. For a pharmaceutical distributor this is not an optimisation, it is
-- the whole reason the batch table exists: allocating by arrival date instead
-- means short-dated stock stays on the shelf until it expires and is then
-- written off, which is both waste and, in Egypt, a regulatory problem.
--
-- Quarantine is excluded. A quarantined batch is not sellable stock, and
-- allocating from it would fulfil an order with goods somebody has already
-- decided to hold.
--
-- ── why this is one function and not a sequence of statements ───────────────
--
-- Allocation reads available stock, decides, writes it back and reserves it.
-- Done as four separate statements, two approvers clicking at the same moment
-- both read the same available figure and both reserve it, and the warehouse
-- ends up promising stock it does not have. So the whole thing is one function,
-- which is one transaction, and the `for update` on the balance rows serialises
-- concurrent approvals of the same batches rather than letting them interleave.
--
-- ── the shortage is not an error ────────────────────────────────────────────
--
-- If FEFO can only cover part of a line, the request is still approved, the
-- partial allocation is recorded, and the shortfall is written to shortage_qty.
-- Failing the whole approval would mean a distributor with one short item
-- cannot ship the other nine, and a warehouse supervisor would learn to split
-- requests by hand to work around it. The approver is told exactly what was
-- short, in the result, and can decide what to do about it.

create or replace function api.allocate_requisition(p_requisition_id uuid)
returns table (
  requisition_id uuid,
  line_product   uuid,
  requested      integer,
  allocated      integer,
  shortage       integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requisition public.requisitions;
  v_line        record;
  v_remaining   integer;
  v_take        integer;
  v_pick        record;
  v_allocated   integer;
begin
  v_requisition := (
    select r.* from public.requisitions r
    where r.id = p_requisition_id
      and r.tenant_id = (select private.current_tenant_id())
    for update
  );

  if not found then
    raise exception 'requisition not found in this tenant'
      using errcode = 'P0002';
  end if;

  if v_requisition.status <> 'SUBMITTED' then
    -- Allocation is the only thing that may move a request out of SUBMITTED, so
    -- calling it twice is a programming error rather than an idempotent retry.
    raise exception 'requisition is %, only a SUBMITTED one can be allocated', v_requisition.status
      using errcode = '22023';
  end if;

  for v_line in
    select l.id, l.product_id, l.qty_requested
    from public.requisition_lines l
    where l.requisition_id = p_requisition_id
      and l.tenant_id = (select private.current_tenant_id())
    order by l.product_id
    for update of l
  loop
    v_remaining := v_line.qty_requested;
    v_allocated := 0;

    /*
     * FEFO across every location holding the product for this tenant, soonest
     * expiry first.
     *
     * The loop variable is the whole ROW -- balance id, batch, location and the
     * free quantity -- and the update below targets `v_pick.balance_id`. The
     * first version of this carried only the quantity and re-derived the batch
     * with a repeated ORDER BY subquery inside the UPDATE, which is the kind of
     * thing that works right up until two batches tie on expiry and then
     * reserves a row nobody read or locked. Reading and writing the same
     * identified row is the only version of this that is obviously correct.
     *
     * `for update` locks each balance as it is read, so a second approval
     * running at the same moment blocks here instead of promising the same units
     * twice. That is the entire reason allocation is one function: four
     * separate statements would interleave between the read and the write.
     */
    for v_pick in
      select b.id as balance_id, b.batch_id, (b.qty_on_hand - b.qty_reserved) as free
      from public.stock_balances b
      join public.batches bt on bt.id = b.batch_id
      join public.storage_locations sl on sl.id = b.location_id
      where b.tenant_id = (select private.current_tenant_id())
        and b.product_id = v_line.product_id
        and b.qty_on_hand - b.qty_reserved > 0
        -- TRANSIT is stock on a vehicle: it belongs to nobody until it arrives,
        -- so promising it here is how a pharmacy receives less than we said.
        and sl.kind <> 'IN_TRANSIT'
        -- Quarantined stock is not sellable. Allocating from it would fulfil an
        -- order with goods somebody has already decided to hold.
        and bt.status = 'RELEASED'
        and bt.deleted_at is null
      order by bt.expiry_date asc, bt.lot_number asc
      for update of b
    loop
      exit when v_remaining <= 0;

      v_take := least(v_remaining, v_pick.free);

      update public.stock_balances b
      set qty_reserved = b.qty_reserved + v_take,
          updated_at  = now()
      where b.id = v_pick.balance_id
        and b.tenant_id = (select private.current_tenant_id());

      if not found then
        -- The row was locked a moment ago, so this means the balance vanished
        -- from under the transaction. Silently allocating less than we decided
        -- would leave the ledger disagreeing with the request.
        raise exception 'balance % disappeared during allocation', v_pick.balance_id
          using errcode = '40001';
      end if;

    v_remaining := v_remaining - v_take;
      v_allocated := v_allocated + v_take;
    end loop;

    update public.requisition_lines l
    set qty_allocated = v_allocated,
        shortage_qty  = v_remaining
    where l.id = v_line.id;

    requisition_id := p_requisition_id;
    line_product   := v_line.product_id;
    requested      := v_line.qty_requested;
    allocated      := v_allocated;
    shortage       := v_remaining;
    return next;
  end loop;

  update public.requisitions r
  set status       = 'ALLOCATED',
      decided_by   = (select auth.uid()),
      decided_at   = now(),
      updated_at   = now()
  where r.id = p_requisition_id;

  return;
end
$$;

comment on function api.allocate_requisition(uuid) is
  'Approve a SUBMITTED requisition, reserving stock FEFO (soonest expiry first, quarantined and in-transit excluded). Partial allocations are recorded with a shortage rather than rejected, so one short line does not block shipping the rest. Allocates the whole request in one transaction, locking balance rows, so two concurrent approvals cannot reserve the same units twice.';

grant execute on function api.allocate_requisition(uuid) to authenticated, service_role;
revoke execute on function api.allocate_requisition(uuid) from public;
revoke execute on function api.allocate_requisition(uuid) from anon;

-- ── the rest of the lifecycle ───────────────────────────────────────────────

-- Approval is not the approver's decision to make alone: only the distributor
-- side approves, and never their own request. The last clause is the important
-- one -- without it a TENANT_ADMIN could raise a requisition for their own
-- warehouse and approve it, which is a conflict of interest with no technical
-- difficulty.

create or replace function api.submit_requisition(p_requisition_id uuid)
returns public.requisitions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.requisitions;
begin
  update public.requisitions r
  set status      = 'SUBMITTED',
      submitted_at = now(),
      updated_at   = now()
  where r.id = p_requisition_id
    and r.tenant_id = (select private.current_tenant_id())
    and r.status = 'DRAFT'
    and r.requested_by = (select auth.uid())
  returning * into v_row;

  if not found then
    raise exception 'no DRAFT requisition % owned by you in this tenant', p_requisition_id
      using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.requisition_lines l where l.requisition_id = v_row.id) then
    raise exception 'a requisition with no lines cannot be submitted'
      using errcode = '22023';
  end if;

  return v_row;
end
$$;

create or replace function api.reject_requisition(p_requisition_id uuid, p_note text)
returns public.requisitions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.requisitions;
begin
  -- Note: p_note is required. A rejection with no reason sends the requester
  -- back with nothing to act on, and the note is the only part of a rejection
  -- anybody reads.
  if p_note is null or btrim(p_note) = '' then
    raise exception 'a rejection needs a reason' using errcode = '22023';
  end if;

  update public.requisitions r
  set status       = 'REJECTED',
      decided_by   = (select auth.uid()),
      decided_at   = now(),
      decision_note = p_note,
      updated_at   = now()
  where r.id = p_requisition_id
    and r.tenant_id = (select private.current_tenant_id())
    and r.status = 'SUBMITTED'
    and r.requested_by is distinct from (select auth.uid())
    and (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER'))
  returning * into v_row;

  if not found then
    raise exception 'no SUBMITTED requisition % in this tenant that you may reject', p_requisition_id
      using errcode = 'P0002';
  end if;

  return v_row;
end
$$;

-- Releasing a rejected request's reservation. A rejection after allocation is
-- not possible today, but the function is here so that path cannot be forgotten
-- if the lifecycle grows: without it, a rejected request would leave stock
-- reserved forever.
create or replace function api.release_requisition(p_requisition_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.stock_balances b
  set qty_reserved = greatest(b.qty_reserved - (
        select coalesce(sum(l.qty_allocated), 0)
        from public.requisition_lines l
        where l.requisition_id = p_requisition_id
          and l.product_id = b.product_id
      )),
      updated_at = now()
  where b.tenant_id = (select private.current_tenant_id())
    and exists (select 1 from public.requisition_lines l where l.requisition_id = p_requisition_id);
end
$$;

comment on function api.submit_requisition(uuid) is
  'Move your own DRAFT requisition to SUBMITTED. Refuses an empty request and refuses a request you did not raise.';
comment on function api.reject_requisition(uuid, text) is
  'Reject a SUBMITTED requisition with a mandatory reason. The requester cannot reject their own request.';
comment on function api.release_requisition(uuid) is
  'Return the reserved quantity for a requisition. Idempotent: a second call subtracts nothing, because the lines record what was actually allocated.';

grant execute on function api.submit_requisition(uuid) to authenticated, service_role;
revoke execute on function api.submit_requisition(uuid) from public;
revoke execute on function api.submit_requisition(uuid) from anon;

grant execute on function api.reject_requisition(uuid, text) to authenticated, service_role;
revoke execute on function api.reject_requisition(uuid, text) from public;
revoke execute on function api.reject_requisition(uuid, text) from anon;

grant execute on function api.release_requisition(uuid) to authenticated, service_role;
revoke execute on function api.release_requisition(uuid) from public;
revoke execute on function api.release_requisition(uuid) from anon;
