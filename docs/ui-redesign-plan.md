# UI redesign plan

The reference research, what it changes here, what is done, and what is next.

---

## The references

Three were studied in depth, and each one is relevant to a *different* part of what
Bershama is:

| Reference | Why it is here |
|---|---|
| **Linear** — linear.app | The reference for dense operational lists, and the only one of the three that has solved *triage*: a long list where the job is to decide what to deal with first. The distributor admin's screen is a queue, not a dashboard. |
| **Grafana** — grafana.com, play.grafana.org | The reference for "operational state over a time window". Bershama has three time-bounded things — cold chain, valuation, expiry burn-down — and Grafana's time-range control, chart-to-table drill, and alert *state* vs alert *health* are directly applicable. |
| **Retool Mobile** — retool.com | The only one that covers the **driver on a phone**. Its scanning and offline-mode documentation is the clearest public spec for "what happens when the driver is in a basement with no signal". |

**The two references for behaviour** (not pixels) are **Zoho Inventory** — it carries
manufacture and expiry dates through every movement and auto-sorts batches
first-expiring-first — and **Shopify admin**, for bulk selection and saved views.

None of the three ships Arabic or RTL. For that the sources are **Material 3
Bidirectionality** and **Apple HIG Right-to-left**, not any of the three.

---

## The five patterns to steal

| # | Pattern | From | What it means here |
|---|---|---|---|
| 1 | **Filters and display options are two separate systems** | Linear | Filters decide *which rows*; column visibility decides *which columns*. Filters go in the URL (a link pasted into Slack lands the same filtered list); column preferences are per-user, in localStorage. This is how "too many columns" gets solved without destroying the view. |
| 2 | **Alert state is split: needs action / can wait, with snooze** | Linear Inbox | A cold-chain breach at 03:00 and a shift reminder are different *kinds* of thing and must not be one undifferentiated feed. Read/unread is encoded in **text luminance**, not a dot or a background tint — it survives a greyscale printout. |
| 3 | **Rule state and rule health are separate** | Grafana Alerting | "Did it fire?" and "did the system actually look?" are different questions. The second is the auditor's question: *did the nightly scan actually run?* A rule can be firing correctly and still be broken (Error / NoData). |
| 4 | **One global, URL-addressable time range** | Grafana | Expiry and cold chain are meaningless without a window, and "the same link shows the same window" is a **compliance** property, not a convenience. Presets, absolute dates, and step buttons that shift the window by exactly one window-length. |
| 5 | **Scan = one action, focus never lost, offline writes visible** | Retool Mobile | The difference between a driver using the app every run and a driver using it once. |

Two honourable mentions, both cheap and both high value: the **chart + table twin**
(Grafana — the chart is a screenshot, the data is unavailable, and an auditor needs the
data), and **typed confirmation for destructive actions** (Grafana — "write off batch"
requires typing the batch number; free compliance evidence).

---

## Three things that are common in operational dashboards and are genuinely bad

These are the ones to avoid, and the existing screens contain two of them.

**1. A card grid for data that must be compared row-wise.** Batches, requisitions,
stops and alerts are lists of records with attributes to compare. A card grid forces
the reader to hold card 1's expiry in their head while reading card 5, makes "sort by
expiry" impossible, and destroys the vertical alignment that expiry scanning depends
on. **Table for everything; cards only for a genuine one-of-N decision with a small
candidate set.**

**2. Infinite scroll on a prioritised queue.** It destroys the sense of backlog size,
makes the URL un-shareable, and makes "I have handled everything" unprovable. A
supervisor needs a denominator: always show `1–50 of 1,284`, and put the total in the
empty state too — *"0 alerts — 1,284 batches scanned at 02:00"*, not a blank panel.

**3. Colour-only status, and colour as the primary carrier of expiry urgency.**
Expiry state is the single most safety-critical value in this product. A red/amber/green
table fails for ~8% of male operators, on a washed-out phone screen in sunlight, and in
the printed report a QA inspector receives. **Encode status three ways — colour + shape
+ literal value.** `12d` in red with a triangle, `28d` in amber with a circle, `>90d`
neutral. And do **not** wash table backgrounds: tint the single most urgent cell, use
coloured *text* elsewhere.

Two more that will come up: **a modal for every edit** (inline-edit status and
priority from the row; reserve modals for genuine multi-field forms), and
**auto-refresh that reorders rows under the user's cursor** (Grafana ships auto-refresh
off by default; keep it off, and never let a refresh change row order while a row is
hovered or focused).

---

## What has been done

Four surfaces rebuilt on the new primitives, in `components/ui`:

| File | What it is |
|---|---|
| `data-table.tsx` | The table every list screen uses. A real `<table>` with a caption, dense rows (36px, 13px type, tabular figures), sortable-ready columns, per-row actions, and a card layout under `md`. |
| `page-header.tsx` | Title, what is on the screen, and the actions — one shape for every screen. |
| `stat-tile.tsx` | A figure with the sentence that makes it mean something. A figure that is not available says so; it does not show a zero, because a zero is a claim about the world. |
| `badge.tsx` | Status as colour + shape + word, plus `Ltr` for the LTR facts inside an Arabic sentence. |
| `empty-state.tsx` | What is empty, why, and the one thing to do about it. |
| `toolbar.tsx` | One labelled search landmark, instead of a form among five. |

**Rebuilt surfaces:** the catalogue (a real table, five columns instead of twelve
facts, named actions), the batches list (**days-to-expiry is its own column and is
always populated** — it used to be blank for every healthy batch), the alert centre's
severity (a triangle/circle/square next to the word, instead of a coloured dot marked
`aria-hidden`), and the dashboard's figures (the corner notch is gone: it was the same
on all four, so it said nothing about which figure mattered).

**Verified:** the catalogue went from 0 tables / 0 rows / 44 roleless elements / six
form landmarks / five identical "Edit" labels to a proper table with named actions.
The batches screen now answers the question it exists to answer.

---

## What is next

The other list screens still roll their own markup. In order of how much they cost a
person:

1. **Requisitions** — a queue, so Linear's triage model applies: needs action vs
   can wait, accept/decline in-row, and the keyboard path.
2. **Deliveries and the driver's run** — Retool Mobile's territory: one scan is one
   action, the scanner never loses focus, the offline queue is a visible user-controlled
   state, and the primary commit action is **not** mirrored in RTL.
3. **Stocktake** — the count sheet becomes a real table with the reason column
   appearing only once there is a variance, and a labelled count input. The 44px
   minimum tap target and "label always above the field" rules apply here, because this
   is the screen a person uses on a phone in a cold store.
4. **Analytics** — the chart + table twin, and the time range in the URL.
5. **The alert centre's structure** — needs action vs can wait, and the scan's own
   health ("did the 02:00 scan run?") beside the alerts it raised.
6. **Column visibility per screen** — display options as a popover, separate from
   filters, persisted per user.
7. **Bulk selection** — `X` to select, `⌘A` within the current filter, a bottom
   toolbar, and the checkbox revealed on hover rather than a permanent column.
8. **Semantic tokens** — the codebase mixes CSS custom properties with `dark:`
   variants. Grafana's lesson: define semantic tokens and switch their *values* under
   `.dark`, rather than sprinkling variants across every class.

---

## The rules that came out of it

Short enough to be checked by eye:

- **Tables for anything compared row-wise. Cards only for a genuine one-of-N
  decision.**
- **Status is colour + shape + word. Never colour alone. Never a background wash.**
- **The countdown is a number, not a date.** "8 days", with the date beside it.
- **Every action names its subject.** "Edit Panadol Extra", not "Edit".
- **Filters and columns are separate systems. Filters in the URL, columns per user.**
- **A figure that is unavailable says so. It is not a zero.**
- **Every empty state says what is empty and what to do next.**
- **One search landmark per screen.**
- **LTR facts are isolated with `<bdi>`.** Lot numbers, SKUs, quantities, dates,
  temperatures.
- **The destructive action is typed, not clicked.**
- **Tap targets are 44px on a phone. The label is always above the field.**
- **A refresh never reorders rows under the pointer.**
