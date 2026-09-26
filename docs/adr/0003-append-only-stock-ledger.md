# 0003. Append-only stock ledger with materialised balances

Status: Accepted

## Context

A pharmaceutical distributor's stock record is evidence. When a regulator asks
"what did you hold of lot A123 on 15 March, and where did it go", the answer has
to be reconstructible. So does the answer to the question a pharmacist will ask
after a delivery went wrong: "you delivered two boxes, the invoice says two, and
I have one."

That rules out the obvious design. A mutable `stock` table with
`quantity = quantity - 1` has no history: the previous value is gone, the
arithmetic is not attributable, and a bug that decrements twice is
indistinguishable from a bug that decremented once.

The alternative — an append-only ledger of movements, with current stock derived
— has a real cost. Deriving "how much is at location L" from a full movement
history means summing, on every read, over a table that grows without bound. On
every product list render. That is not viable.

So: a ledger, and a materialised balance for speed, which means keeping two
things that must agree.

## Decision

**`stock_ledger`** is append-only. One row per movement, with a signed
`qty_delta`, a `txn_type`, a reference to the transaction that caused it, the
actor, and a timestamp.

- A `BEFORE UPDATE OR DELETE` trigger raises for every role including the owner.
  Corrections are new compensating rows.
- The ledger is not client-writable. `post_stock_movement()` is the only writer.

**`stock_balances`** is a materialisation keyed by
`(tenant_id, location_id, product_id, batch_id)`, written in the same
transaction as the ledger row. Never written independently.

**`reconcile_stock_balances()`** runs nightly, rebuilds the balances from the
ledger, and raises a `CRITICAL` alert on any difference.

**In-transit is a location.** Dispatching moves stock to a virtual
`IN_TRANSIT` location rather than deleting it. A delivery moves it to the
destination. Total stock is therefore conserved while a truck is moving, and
expiry ownership is unambiguous: the distributor still owns it, and it is still
the distributor's problem if it expires in the van.

Batches are never hard-deleted. Only state transitions —
`RELEASED ⇄ QUARANTINED`, and `RECALLED` with a reason.

## Consequences

### Positive

- **Every number is explainable.** A balance disagreement with physical stock can
  be traced to specific movements.
- **Mistakes are survivable.** A wrong receipt is a correcting movement, not an
  edit that destroys the evidence of the mistake.
- **Reconciliation is a genuine check, not a tautology.** Because the nightly job
  rebuilds from the ledger independently, it can disagree — and when it does, that
  is a real signal rather than a restatement of what was already believed.
- **Transit stock is visible.** Stock in a van shows up in the total, which is the
  difference between "short by twelve boxes" and a known quantity on route 3.
- **Aligns with WHO GDP.** Traceability and record integrity are requirements, not
  aspirations, and this satisfies them by construction.

### Negative

- **The ledger grows without bound.** One row per movement, forever. Needs
  monthly partitioning of `tracking_pings` and eventually of the ledger, plus a
  retention decision for archived years. Not designed yet, and it is a real piece
  of future work.
- **Two sources of truth in practice.** The design says the ledger is the truth
  and the balance is a cache. In practice, a balance that is wrong in the gap
  before the nightly reconcile is a user-visible wrong number. The window is
  small, and a `CRITICAL` alert follows it, but the honest statement is that this
  design trades "impossible wrong number" for "briefly wrong number, detected
  nightly".
- **Storage doubles the write cost.** Every movement writes two rows.
- **Replay is required to rebuild.** The balance cannot be verified by inspection;
  it needs the ledger. That is the point, but it means the ledger must be
  complete, forever, with no archival that discards it.

### Neutral

- **No ORM-friendly shape.** An append-only ledger with a balance projection is
  awkward to express in an ORM and natural in SQL. This contributed to
  [0001](0001-supabase-native-backend.md).
- **Ledger row count is the scaling limit.** Movement volume, not product count,
  is what grows. Worth watching; not a problem at pilot scale.
