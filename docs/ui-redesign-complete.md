# Redesign — complete

The full pass. Every surface, on the shared primitives, verified as a real user
before it ships.

Each item states what it changes and how it is checked. Nothing is "done" until the
crawl says so.

**The pass found two things the code review would not have.** The pharmacy surface
carried a paragraph of English hard-coded into the JSX — on the Arabic page that
paragraph was English, because it had never been a translation at all. And the
requisition count read "1 requisitions raised", which the repository's own i18n test
caught as a missing ICU plural.

Both were the kind of thing that a linter cannot see and a person notices in a
minute.

## A — the list surfaces

- [x] **A1 Catalogue** — real table, five columns, named actions. `data-testid` kept.
- [x] **A2 Batches** — days-to-expiry as its own column, always populated.
- [x] **A3 Alert centre** — severity as colour + shape + word.
- [x] **A4 Requisitions** — a queue, so it gets Linear's triage shape: needs action
      vs can wait, the state in words, and the decision inline. The single most
      time-consuming screen for a distributor.
- [x] **A5 Deliveries** — the run list: trip, date, driver, stops, state.
- [x] **A6 The driver's run** — the phone surface. Retool's rules: one scan is one
      action, the scanner never loses focus, the offline queue is a visible
      user-controlled state, and the commit action is NOT mirrored in RTL.
- [x] **A7 Pharmacy surface** — what a pharmacy manager actually opens.
- [x] **A8 The inventory hub** — currently three cards and 90% whitespace.

## B — the forms

- [x] **B1 Every field** — label always above the control, never placeholder-as-label,
      44px minimum tap target on a phone, error text tied to its control.
- [x] **B2 The stocktake count sheet** — a real table, the reason only once there is
      a variance, and a count input sized for a thumb. This is the screen a person
      uses on a phone in a cold store.
- [ ] **B3 The requisition line editor** — the most complex form in the app.

## C — the public screens

- [x] **C1 Sign in** — the pitch, the two ways in, and no credential in the URL.
- [x] **C2 Sign up** — one clear path, the org name first.
- [x] **C3 Setup** — the screen between signing up and having an organisation.

## D — the dashboard

- [x] **D1 The figures** — the notch is gone; the tiles read as a set.
- [x] **D2 The hero** — a 300px panel holding "EGP 0" is not a hero.
- [ ] **D3 Waiting on you** — the queue, with a denominator.
- [ ] **D4 Every figure** — no figure that is unavailable is shown as a zero.

## E — the alert centre, properly

- [ ] **E1 Needs action vs can wait** — a cold-chain breach at 03:00 and a shift
      reminder are not the same kind of thing.
- [ ] **E2 The scan's own health** — "did the 02:00 scan run?" beside the alerts it
      raised. This is the auditor's question.
- [ ] **E3 Read and unread** — encoded in text luminance, so it survives a
      greyscale printout.

## F — analytics

- [x] **F1 Chart and table twin** — the chart is a screenshot; the data has to be
      there for an auditor and for a driver on a bad connection.
- [ ] **F2 The time range in the URL** — "the same link shows the same window" is a
      compliance property, not a convenience.

## G — the system underneath

- [ ] **G1 Column visibility per screen** — display options as a popover, separate
      from filters, persisted per user.
- [ ] **G2 Bulk selection** — select within the current filter, a bottom toolbar,
      and the checkbox revealed on hover rather than a permanent column.
- [ ] **G3 Semantic tokens** — switch the token *values* under `.dark` rather than
      sprinkling `dark:` variants across every class.
- [ ] **G4 Destructive actions are typed** — "write off batch" requires typing the
      batch number.

## How each is checked

| Kind | Check |
|---|---|
| Every surface | `scripts/ux-audit.mjs` — no crash, no console error, a table where a list was |
| Every surface | the Browser smoke suite, which now visits the list surfaces |
| Accessibility | REA's tree on the changed pages, before and after |
| Type and lint | `make check`, `make typecheck`, `make lint`, `make build` |
| Database | `make test-db` — 14 suites |
| Behaviour | `scripts/verify-ux-fixes.mjs` against the deployed app |

## The rules, short enough to check by eye

- Tables for anything compared row-wise. Cards only for a genuine one-of-N decision.
- Status is colour + shape + word. Never colour alone. Never a background wash.
- The countdown is a number, not a date.
- Every action names its subject.
- Filters and columns are separate systems. Filters in the URL, columns per user.
- A figure that is unavailable says so. It is not a zero.
- Every empty state says what is empty and what to do next.
- One search landmark per screen, and every landmark named.
- LTR facts are isolated with `<bdi>`.
- The destructive action is typed, not clicked.
- Tap targets are 44px on a phone. The label is always above the field.
- A refresh never reorders rows under the pointer.
