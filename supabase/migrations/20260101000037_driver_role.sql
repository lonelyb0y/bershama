-- A driver is a role, not a flavour of dispatcher.
--
-- The demo tenant had a `driver@demo.local` account, but it was a DISTRIBUTOR, and
-- the enum had no DRIVER member at all. That was honest about what had been built
-- -- there was no driver surface to route to -- and it is the first thing M4 needs
-- to change, because a person who drives a van all day is not a person who plans
-- runs and watches a map.
--
-- Adding the value is a separate migration from using it on purpose: a new enum
-- member cannot be used in the same transaction that adds it.

alter type private.app_role add value 'DRIVER' after 'DISPATCHER';

comment on type private.app_role is
  'Application roles. DRIVER is a warehouse-side role: it plans nothing and reports for nothing, it works a run -- starts it, arrives at stops, and takes the proof-of-delivery signature. It is deliberately separate from DISPATCHER so that a dispatcher who can dispatch any run cannot also sign for its deliveries.';
