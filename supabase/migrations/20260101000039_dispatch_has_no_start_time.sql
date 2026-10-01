-- Fixing trips_started_has_time, which I got wrong in 0035.
--
-- The constraint read `status = 'PLANNED' or started_at is not null`, which required
-- a start time on DISPATCHED. That is not how a run works: dispatching is the
-- moment the paperwork leaves, and the van is still at the depot. started_at is
-- when the driver pressed start, one state later. So the first dispatch failed on
-- a constraint that was mine, not a transition anybody had got wrong.
--
-- The rule that was actually meant: a run which is on the road has a start time.
-- DISPATCHED is "allocated to a driver and waiting", and IN_TRANSIT is "moving".
--
-- The same mistake is worth naming because the two states sit next to each other in
-- the enum, and only one of them is a claim about physical movement.

alter table public.trips
  drop constraint if exists trips_started_has_time;

alter table public.trips
  add constraint trips_started_has_time
  check (status not in ('IN_TRANSIT', 'COMPLETED') or started_at is not null);

comment on constraint trips_started_has_time on public.trips is
  'A run that is on the road has a start time. DISPATCHED is exempt on purpose: that is the paperwork leaving, not the van. An IN_TRANSIT run with no start time would tell a dispute nothing.';