# 0003. Append-only stock ledger with materialised balances

Status: Accepted — **amended during M2**, see the Amendment below.

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
`(tenant_id, location_id, product_id, batch_id)`, maintained by an
`AFTER INSERT` trigger on the ledger rather than by the movement function.

*(Amended during M2 — the original wording was "written in the same transaction as
the ledger row. Never written independently." See the Amendment below.)*

**`reconcile_stock_balances()`** runs nightly, compares the balances against the
sum of the ledger, and raises a `CRITICAL` alert on any difference. It detects; it
does not repair. *(Amended during M2.)*

**In-transit is a location.** Dispatching moves stock to a virtual
`IN_TRANSIT` location rather than deleting it. A delivery moves it to the
destination. Total stock is therefore conserved while a truck is moving, and
expiry ownership is unambiguous: the distributor still owns it, and it is still
the distributor's problem if it expires in the van.

Batches are never hard-deleted. Only state transitions —
`RELEASED ⇄ QUARANTINED`, and `RECALLED` with a reason.

## Amendment: the balance is maintained by a trigger, not by the function

Recorded during M2.

The original decision had `post_stock_movement()` write both the ledger row and the
balance. That is two steps a function has to remember to perform in sequence, and
a future second writer — a data fix, a migration, an import — becomes a way for
them to disagree. The nightly reconciliation was then a genuine repair path, which
sounds like a feature and is really a second source of truth.

The amendment: the function inserts **one** ledger row, and an `AFTER INSERT`
trigger on `stock_ledger` maintains the balance. A movement and its balance update
are the same event. There is no client grant on `stock_balances`, and
`post_stock_movement()` does not touch it, so **no code path writes a balance
without a ledger row** and "the balance disagrees with the ledger" stops being a
reachable state.

Reconciliation consequently changed role. It is now a **detector**: it can find a
problem, never cause one. That is the more valuable property for a system whose
balances are the subject of a regulatory inspection — "we prove it every night" is
a stronger claim than "we fix it every night", and a detector that also repairs can
hide the fact that something was wrong at all.

One implementation note, because the obvious version of the trigger is wrong:
`insert ... on conflict do update` is **not** usable here. Postgres evaluates a
CHECK constraint against the candidate insert row *before* the conflict arbiter
decides to update, so a negative delta against an existing key fails
`qty_on_hand >= 0` on the insert candidate even though the updated value would be
legal. Every outbound movement was refused; only the first receipt worked. The
trigger updates first and inserts only when nothing matched, with a
`unique_violation` handler for the concurrent-first-movement race.

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
