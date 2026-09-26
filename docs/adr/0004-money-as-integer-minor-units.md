# 0004. Money as integer minor units

Status: Accepted

## Context

Prices, invoice totals and stock values have to be exact. The failure mode is
not a dramatic one; it is a small persistent discrepancy that nobody can explain
and everybody has to work around.

The three candidates:

- **`float` / `double precision`** — what a JavaScript number is. Binary
  floating point cannot represent 0.10 exactly. Summing a few thousand invoice
  lines drifts, and the drift is not deterministic enough to reason about.
- **`numeric`** — exact, arbitrary precision. The right type for accounting in
  general, but awkward in TypeScript: it arrives from `supabase-js` as a string
  (Postgres sends `numeric` as text to avoid precision loss), and every consumer
  has to remember to parse it.
- **integer minor units** — store piastres (1 EGP = 100), divide for display.

Egyptian pharmaceutical pricing is often quoted per piastre, which makes the
question concrete rather than theoretical.

## Decision

Every monetary column is `bigint` counting minor units. Conversion to major units
happens once, in `apps/web/src/lib/format.ts`, and the result is never stored.

```sql
unit_cost_minor bigint not null check (unit_cost_minor >= 0)
```

The database enforces non-negativity on unit costs. Quantities may be negative in
a ledger row, because `qty_delta` is signed; a price may not be.

VAT is a tenant setting, never a hardcoded rate, because rates change and a
migration to change a constant is a deployment.

## Consequences

### Positive

- **Exact.** Integer arithmetic in a `bigint` has no representation error at any
  magnitude the domain can reach.
- **Unambiguous at the boundary.** Piastres are integers. There is no "is it
  19.99 or 19.994?" question at any layer.
- **The types say what they mean.** `Minor` in TypeScript, `unit_cost_minor` in
  SQL. A reader knows without checking documentation.
- **Testable.** The formatters are unit-tested with a sweep asserting every value
  from 0 to 100,000 piastres round-trips, plus a case at 12,345,678,901 piastres
  where a float demonstrably drops digits.
- **Rounding is explicit and visible.** Exactly one rounding site, in one file,
  with a test.

### Negative

- **Every consumer must remember to convert.** A raw `unit_cost_minor` rendered
  without `formatMoney` displays 150000 as "150,000 piastres" or, worse, as
  "150,000" where the user expects "1,500.00". This is a real and recurring class
  of UI bug, and the unit tests do not catch a display site that forgets.
- **Currency decimals are assumed to be 2.** Correct for EGP, SAR, AED and USD.
  A currency with 0 or 3 minor units would need the table to change. The map
  exists (`CURRENCY_DECIMALS`) but the assumption is baked into the storage
  decision, so a future currency is a migration, not a config change.
- **More verbose in raw queries.** `sum(unit_cost_minor)` has to be labelled
  clearly so a reader does not think it is a major-unit total.
- **Rounding direction must be chosen per operation.** Display rounds for the
  reader. Totalling rounds according to Egyptian accounting practice, which is a
  business rule that has to be written down rather than assumed. Not yet decided;
  recorded here so it is not decided by accident later.
