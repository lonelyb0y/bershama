# Architecture Decision Records

Each record states the decision, the forces behind it, and what it costs. A
record with no stated cost is a press release.

The numbered files are the ones that shaped the system:

| # | Decision | Status |
|---|---|---|
| [0001](0001-supabase-native-backend.md) | Supabase-native backend, no custom API server | Accepted |
| [0002](0002-rls-and-privileged-functions.md) | The `private` / `api` / `public` schema split | Accepted |
| [0003](0003-append-only-stock-ledger.md) | Append-only ledger with materialised balances | Accepted |
| [0004](0004-money-as-integer-minor-units.md) | Money as integer minor units | Accepted |
| [0005](0005-arabic-and-rtl-from-the-first-commit.md) | Bilingual and RTL from the first commit | Accepted |
| [0006](0006-free-tier-then-paid-before-go-live.md) | Free tiers while learning, paid before production | Accepted |

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
