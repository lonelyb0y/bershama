# 0001. Supabase-native backend, no custom API server

Status: Accepted

## Context

The product needs authentication, a relational database with strong transactional
integrity, file storage, live position updates, scheduled background jobs, and a
generated client for a TypeScript frontend.

The conventional shape is a Next.js frontend plus an API service (Go, NestJS,
Django) plus a Postgres instance. That was the first plan: a Go service with chi
and sqlc, workers on a queue, SSE for the live map.

Three things changed the calculus:

**The operator is one developer.** Every additional process is something to run,
monitor, patch, secure, back up and pay for. An API service is a permanent
operational liability, not a one-time cost.

**There is no capital.** A Go or Node API needs an always-on host. That is a real
monthly cost before there is any revenue.

**The hard part is not request handling.** It is keeping multi-row invariants
true: a balance equal to the sum of its ledger, a FEFO allocation that never
oversells or picks a recalled batch, a dispatch and delivery that balance. Those
are database problems.

Supabase was evaluated against three alternatives:

| | Supabase-native | Go + Supabase | Go + own Postgres | Node service |
|---|---|---|---|---|
| Languages | TS + SQL | Go + TS + SQL | Go + TS + SQL | TS |
| Always-on server needed | no | yes | yes | no |
| Monthly cost at this scale | $0 | $25–30 | €4–5 | $0 |
| Multi-row invariants | same transaction | service + compensating logic | service + compensating logic | same transaction |
| Local dev without Docker | awkward | poor | good | awkward |
| Data residency | no Egypt region | no Egypt region | choose your host | no Egypt region |
| Operational burden | none | one service | host + DB + backups | none |

## Decision

Supabase provides the database, authentication, storage, realtime and cron. The
domain logic is Postgres functions. The Next.js app talks to Supabase directly
from both the server and the browser, with authorization enforced by Row Level
Security.

No custom API server, no ORM, no separate queue.

## Consequences

### Positive

- **Nothing to operate.** No host to patch, no process manager, no TLS
  certificate, no service to restart.
- **One language on the app side.** TypeScript and SQL, with shared types. A
  contract mismatch between a Go service and a TS client is a class of bug that
  simply does not exist.
- **RLS is the security model**, and it is the industry-standard one. Tenant
  isolation is enforced by the engine rather than by a middleware someone has to
  remember to apply.
- **The invariants live next to the data.** A FEFO allocation and the balance
  update it depends on are one transaction, by construction.
- **Realtime and cron are included.** The live driver map and the nightly expiry
  scan are configuration, not projects.

### Negative

- **Domain logic in PL/pgSQL is harder to read than in Go.** A four-hundred-line
  allocation procedure is genuinely worse to review than the equivalent Go. This
  is the real cost and it is paid in reviewability.
- **Testing needs real Postgres.** No mocking a database meaningfully. CI needs
  a database service, and `make test-db` needs a working `initdb`.
- **Vendor coupling is real.** Mitigated but not eliminated: it is a plain
  Postgres, so the escape is a dump and a restore, and the functions would
  largely port. What does not port is Auth, Realtime, Storage and Cron.
- **The free tier pauses.** Project pausing after 7 days of low activity, and no
  downloadable backups. Handled by [0006](0006-free-tier-then-paid-before-go-live.md),
  but it is a real constraint on a system where a paused database is a pharmacy
  that does not get its delivery.
- **No Egypt region.** Nearest is Mumbai or Singapore. Frankfurt was chosen for
  latency and jurisdiction, but a customer with an in-country residency
  requirement cannot be served from here.

### Neutral

- **Edge Functions are available** but currently unused. They are the right tool
  if a flow needs a secret key and a network call; the right answer for almost
  everything else is a Postgres function.
- **Realtime is capped** at 200 concurrent connections and 2M messages/month on
  the free tier. Fine for a pilot with a handful of drivers; a real constraint at
  national scale.
