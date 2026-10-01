-- Sell price on the product, so a margin can be stated at all.
--
-- ── why this column is the whole of "profit" ──────────────────────────────────
-- There was no price anywhere in this schema. `batches.unit_cost_minor` records
-- what the distributor paid, which is the capital side of the question, and nothing
-- recorded what it charges. So there was no honest way to answer "did we make money
-- this month" -- only "did money leave". The gap was not a missing report; it was a
-- missing fact.
--
-- ── on the product, not the batch ────────────────────────────────────────────
-- A selling price is a property of the product and the customer, not of a
-- consignment. Two batches of the same product bought at different prices, one
-- expiring next month and one next year, are the same thing being sold at the same
-- price: the batch difference is *cost*, and cost is what makes the margin vary from
-- batch to batch while the revenue per unit does not.
--
-- Putting the price on the batch would have let the same product carry two prices,
-- and then the margin report would be answering a question nobody asked. So: price on
-- the product, cost on the batch, and the difference between them is the margin per
-- unit for that specific batch. That is the arithmetic a distributor actually wants,
-- because a near-expiry batch bought cheaply is the interesting case.
--
-- ── money as integer minor units ──────────────────────────────────────────────
-- bigint piastres, never a float, per ADR 0004. An Egyptian pound is 100 piastres,
-- so 12,500 is EGP 125.00. Floats here would put rounding error into the one figure
-- a distributor is audited on.
--
-- ── why the default is 0 and not NOT NULL-with-no-default ─────────────────────
-- A price of 0 means "not priced yet", and every margin surface treats it as unknown
-- rather than as free. Adding the column NOT NULL with no default would have failed
-- against every existing product in the demo tenant; the alternative -- nullable --
-- would have made every future query carry a null check that the check constraint
-- below can do once.

alter table public.products
  add column if not exists sell_price_minor bigint not null default 0
    check (sell_price_minor >= 0);

comment on column public.products.sell_price_minor is
  'What the distributor charges per unit, in piastres (ADR 0004: integer minor units, never a float). 0 means not priced yet, and margin surfaces must treat 0 as unknown rather than as free -- a product priced at zero is a data-entry omission, not a giveaway. Paired with batches.unit_cost_minor, which is what was paid: sell minus cost is the margin per unit for that batch, which is the figure that varies when a near-expiry consignment is sold off.';

comment on table public.products is
  'The catalogue. sell_price_minor is what the tenant charges; batches.unit_cost_minor is what it paid. Neither is derived from the other, and the difference between them is the margin -- see sell_price_minor for why the price lives here and the cost lives on the batch.';

-- ── the products table was granted to authenticated for reads ────────────────
-- No grant changes: this is a column, not a table, and a SELECT on the table
-- includes it automatically. Worth saying, because the M4 grants lesson (a policy on
-- a table nobody was granted is a policy about nothing) has an obvious wrong answer
-- here, and it is not this one.

-- ── indexes: none, deliberately ──────────────────────────────────────────────
-- Nothing filters or sorts on a selling price. An index here would cost write
-- throughput on the one table a catalogue edit touches constantly, to serve a query
-- nobody has written yet. If a margin report lands and is slow, that is when to add
-- one -- not before.