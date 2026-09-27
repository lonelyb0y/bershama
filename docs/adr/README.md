# Architecture Decision Records

Each record states the decision, the forces behind it, and what it costs. A
record with no stated cost is a press release.

The numbered files are the ones that shaped the system:

| # | Decision | Status |
|---|---|---|
| [0001](0001-supabase-native-backend.md) | Supabase-native backend, no custom API server | Accepted |
| [0002](0002-rls-and-privileged-functions.md) | The `private` / `api` / `public` schema split | Accepted, **amended in M2** |
| [0003](0003-append-only-stock-ledger.md) | Append-only ledger with materialised balances | Accepted, **amended in M2** |
| [0004](0004-money-as-integer-minor-units.md) | Money as integer minor units | Accepted |
| [0005](0005-arabic-and-rtl-from-the-first-commit.md) | Bilingual and RTL from the first commit | Accepted |
| [0006](0006-free-tier-then-paid-before-go-live.md) | Free tiers while learning, paid before production | Accepted |

## Amendments

Implementation sometimes contradicts a decision, and the implementation is right.
That is not a failure of the record; it is what the record is for.

Both amendments so far were found by tests rather than by review:

- **0002** said every `api` wrapper is `SECURITY INVOKER`. That works for reads
  and is impossible for writes, because `private` has no `USAGE` grant to client
  roles, so an `INVOKER` wrapper cannot reach the code it needs to call. Write
  wrappers are now `SECURITY DEFINER` and are therefore the security boundary in
  their own right.
- **0003** said the movement function writes both the ledger row and the balance.
  A trigger on the ledger now maintains the balance, so drift stopped being a
  reachable state and reconciliation became a detector rather than a repair.

Each amendment states what the original decision was, why it turned out to be
wrong, and what it cost. An amendment that reads as though the original was
silly has usually not been understood.

## Template

```markdown
# NNNN. Title

Status: Proposed | Accepted | Superseded by ADR-NNNN

## Context
The forces at play. What made a decision necessary.

## Decision
What was decided, in the active voice.

## Consequences
### Positive
### Negative
### Neutral
```
