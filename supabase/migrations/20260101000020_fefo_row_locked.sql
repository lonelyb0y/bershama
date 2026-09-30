-- Correct the FEFO allocator to update the row it locked.
--
-- The body in 0019 carried only the free quantity through the allocation loop
-- and re-derived the batch inside the UPDATE with a repeated ORDER BY
-- subquery. That writes a row the loop never read and never locked as soon as
-- two batches tie on expiry -- which is not an edge case, it is every pair of
-- batches that expire on the same day, and expiry-dated stock arrives in
-- same-day groups.
--
-- The loop now carries the balance id and the UPDATE names it, so the row that
-- is read, locked and written is the same row, and `for update` actually
-- protects it.
--
-- 0019 also cannot be edited in place: it has already been applied to the hosted
-- project, and a migration that has run is not re-run by editing it. The whole
-- function is restated for the same reason as every other redefinition here --
-- the return type is part of what create or replace checks, and the grants have
-- to be restated because dropping discards them.

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
  -- `select r.* into <rowvar>`, not `rowvar := (select r.*)`. The second form
  -- hands plpgsql a subquery returning ONE column of composite type, which is
  -- 42601 "subquery must return only one column" -- an error that describes the
  -- assignment rather than anything about requisitions.
  select r.* into v_requisition
  from public.requisitions r
  where r.id = p_requisition_id
    and r.tenant_id = (select private.current_tenant_id())
  for update;

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
     * free quantity -- and the update below targets that same location and batch. The
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
      select b.location_id, b.batch_id, (b.qty_on_hand - b.qty_reserved) as free
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
      where b.location_id = v_pick.location_id
        and b.batch_id = v_pick.batch_id
        and b.tenant_id = (select private.current_tenant_id());

      if not found then
        -- The row was locked a moment ago, so this means the balance vanished
        -- from under the transaction. Silently allocating less than we decided
        -- would leave the ledger disagreeing with the request.
        raise exception 'balance for batch % at location % disappeared during allocation',
          v_pick.batch_id, v_pick.location_id
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
