# Bershama remediation plan — audit + fix prompt

**Repo:** `https://github.com/lonelyb0y/bershama` (local: `/home/taha/projects/pharmaflow`) — app at `apps/web/`.
**Branch:** `main`, working tree dirty on 4 files (leftover `data-testid` hacks).
**Last commit:** `fae7237 Fix horizontal overflow on mobile and desktop pages`.
**Status:** Production READY but e2e Browser job currently fails 5/36. Rebuilt pages are static mockups; no server forms/actions are wired anywhere on them.

**This document is two things:**
1. **Part 1 — The master prompt** (copy-paste block, below). Paste this whole block to an agent and ask it to execute.
2. **Part 2 — The remediation plan** — per-file fix instructions ordered as tasks, plus acceptance gates.

Do not start executing anything until you have read this whole document and confirmed the task order with the human partner if anything is ambiguous.

---

# Part 1 — The master prompt (copy-paste)

You are fixing Bershama, a Next.js 16 pharma-distribution console at `apps/web/`. The app was recently rebuilt on the Stitch designs in `.stitch/designs/*.html`. Every rebuild stripped the interactive layer: pages are now static server components with zero `<form>`/`onClick`, hardcoded/fake data, dead buttons, duplicate headers nested inside the global `AuthenticatedShell`, and several role-dead links. Your job: restore real functionality, stop presenting fabricated data as real, and make every rebuilt page match its design without adding *new* chrome.

## Non-negotiable constraints

- **No paid plans.** Free tier only. Vercel hosting. No Docker for the app. No local Supabase stack for the app. Strix (separate) needs Docker locally; the app itself must not.
- **Palette:** warm parchment `#F6F3EC` / charcoal `#141613`, jade accent `#43B189`. Light + dark. No neon/AI-slop. Typography is rounded.
- **Floating labels sit INSIDE the box, never above.** Use `scripts/check-spacing.mjs` to enforce a 4px grid.
- **Icons from `kazdenc/regen-icons`.** Bklit charts where charting is required. Vanta.js only on home desktop.
- **No language switcher in any header; language lives on `/settings`.**
- **Real data only.** Fabricated design values are defects (no `Node 04`, `EGP 62,400`, `7e2f-90a1-c884`, `CAI-2026-N04`, `PH-1006`, fake pharmacies, fake proof rows, hardcoded chart y-axes).
- **Google OAuth must resolve the role after code exchange and redirect to `homeRouteForRole(role)`, honoring a validated `next` deep link.**
- **Remove per-page `<header>`/`<main>`/`min-h-[100dvh]` wrappers; `AuthenticatedShell` owns chrome and landmarks. Pages keep only a title/action block.**
- **Reconnect, don't rewrite.** Every orphaned interactive component and server action still exists on disk and is intact: `AlertScanButton`, `AlertList`, `ProductForm`, `ProductTable`, `LocationForm`, `RequisitionQueue`, `NewRequisitionForm`, `RequisitionLineEditor`, `RemoveLineButton`, `CountSheet`, `NewVehicleForm`, `NewRunForm`, `AddStopForm`, `DispatchForm`, `ArriveButton`, `SignSheet`, `FailStopForm`, `RunControls`, `LivePositionReporter`, `DeliveryMap`, `ServiceWorkerRegistration`. Server actions still exist: `products/actions.ts`, `requisitions/actions.ts`, `stocktake/actions.ts`, `alerts/actions.ts`, `deliveries/actions.ts`, `driver/actions.ts`. Do not reimplement business logic; wire these in.
- **Never claim completion without running `make check` (or the relevant subset) and seeing it pass.** Then `make build`, `make typecheck`, `make lint`, `make test`, and the e2e suite (5 currently failing: alerts ×3, auth pharmacy, auth driver). Capture screenshots at 1440×900 / 834×1112 / 390×844, all pages, app vs design pairs in `/tmp/opencode/shots/{design,app,pairs}/`.
- **Lighthouse before/after documented.** Desktop adds `--preset=desktop`.
- **One plan document with: master prompt (this block), defect register with file:line evidence, ordered fix tasks, acceptance gates.** That document is this file.

## Defect register (P0 first)

Each entry: what is broken, evidence (file:line), required fix.

### P0 — Auth / redirect / navigation (blocks sign-in flows)

**D1. Google OAuth always lands on `/en` (marketing page), not role home.**
- Evidence: `apps/web/src/components/google-signin-button.tsx:46` — `redirectTo` is always `${origin}/auth/callback?next=/${locale}`. `apps/web/src/app/auth/callback/route.ts:69` — redirects to `safeNext` with no role lookup. `apps/web/src/app/[locale]/page.tsx` (landing) does not redirect signed-in users, so they sit on the marketing page after sign-in.
- Fix: `google-signin-button.tsx` — accept an optional `next` deep link (read from login page `searchParams.next` if present), else `next=/${locale}`. `callback/route.ts` — after `exchangeCodeForSession` succeeds, call `getSession()` (server) on the same client, read `session.role`, default redirect to `homeRouteForRole(role)`; honor validated `next` when supplied. Landing page redirects signed-in visitors to their home route.

**D2. Sign-in/role landing: auth.spec asserts pharmacy/driver land on their surface.**
- Evidence: `e2e/auth.spec.ts:96` asserts `getByRole('navigation')` visible after sign-in. CI fails for pharmacy/driver because rebuilt surfaces expose two `<nav>` roles (global shell nav + page's own nav strip) → strict-mode violation → test fails.
- Fix: remove page-level nav strips so only `AuthenticatedShell`'s nav remains (see D3).

### P0 — Duplicate headers / landmarks / h1 (visual + accessibility)

**D3. Seven authenticated pages render their own `<header>` inside `AuthenticatedShell` (which already has one).**
- Evidence: `<header` at `admin/alerts/page.tsx:60`, `admin/deliveries/page.tsx:52`, `admin/analytics/page.tsx:93`, `admin/inventory/stocktake/page.tsx:120` (`fixed top-0`, overlaps shell), `distributor/page.tsx:109`, `driver/page.tsx:65`, `pharmacy/page.tsx:50`. Each page header carries logo/nav/profile/language duplicates that duplicate `HeaderCluster` in the shell, cause horizontal overflow, and cover the shell header when scrolling (`z-50` vs shell).
- Fix: delete every per-page `<header>…</header>` block (and its `<main className="…">` + `min-h-[100dvh]` wrapper). Replace with a plain `<section>`/`<div>` containing a page-title/action bar only (`<h1>` + `t('title')`). Global shell stays the single header/nav landmark.

**D4. Eight pages render a nested `<main>` inside the shell's `<main>` (invalid landmarks, double scrolling).**
- Evidence: `admin/alerts`, `admin/deliveries`, `admin/analytics`, `admin/inventory/stocktake`, `distributor`, `driver`, `pharmacy`, `admin/inventory/requisitions` all have `<main`.
- Fix: remove `<main>`; pages only contain `<section>` children of the shell's `main`.

**D5. Duplicate `<h1>`: `SignupForm` repeats "Create your organisation"; `SetupForm` repeats "Finish setting up".**
- Evidence: `AuthShell` renders `<h1>{title}</h1>` at `components/auth/auth-shell.tsx:80`. `components/signup-form.tsx:187` renders its own `<h1>{t('title')}</h1>` ("Create your organisation" vs shell's "Create an organisation"). `components/setup-form.tsx:91` renders `<h1>{t('title')}</h1>` ("Finish setting up" duplicates shell title).
- Fix: `SignupForm`/`SetupForm` use `<h2>` for their section headings (or remove their heading block entirely); keep a single `<h1>` per page (the shell's).

### P0 — Functionality stripped by the redesign (reconnect orphaned UI)

Every rebuilt page below is a server component with `0 <form>`, `0 onClick`. Restore the components/actions listed against each.

**D6. Alert centre — scan missing, acknowledge/resolve missing, status filters missing.**
- Evidence: `admin/alerts/page.tsx` has static `sortedRows` list (line ~160), no `run-alert-scan` testid (added only as leftover test hack), no `ack-`/`resolve-` forms, no severity ordering, fake "Node 04 Cairo Central" hub header (line 71), fake "EDA Lic. GZ-7704" (line 112).
- Fix: import `AlertScanButton` + `AlertList` from `./alert-scan`/`./alert-list`; pass real alert rows from `alert_events` via `getSupabase()`; `t('mode.needsAction')`/`t('mode.resolved')` exist at lines 137/140 as filter pills but nothing drives them. i18n fix: `t('alerts.allClear')` at lines 178/179 resolves `alerts.alerts.allClear` (wrong namespace); change to `t('allClear')` / `t('allClearHint')`.

**D7. Deliveries — planning forms, run selection, stop list, map, proofs all gone; `?new=true` ignored.**
- Evidence: `admin/deliveries/page.tsx` links `href="/admin/deliveries?new=true"` (line ~138) but reads no `searchParams`. No `NewVehicleForm`, `NewRunForm`, `AddStopForm`, `DispatchForm`, `DeliveryMap`, `stop-list`. Proof table at lines ~320-400 hardcodes `Orchard Branch Pharmacy`, `Al-Amal Clinical Center`, `Misr Central Pharmacy`, `Ring Road`, `48 km/h`, `11:42`, `7e2f-90a1-c884`, `2.8 °C`. Telemetry row hardcodes `Node 04 Cairo Central` (line 94), `2.8 °C` (line 212).
- Fix: read `searchParams.run`; render `run-*` rows with `data-testid={`run-${run_date}`}`; click→show `stop-list`; restore `NewVehicleForm`/`NewRunForm`/`AddStopForm`/`DispatchForm` wired to `deliveries/actions.ts` (`createVehicleAction`, `createTripAction`, `addStopAction`, `dispatchTripAction`); restore `DeliveryMap`; proofs must be real records, not hardcoded rows.

**D8. Analytics — hardcoded chart, missing panels, `show-numbers` inert.**
- Evidence: `admin/analytics/page.tsx` SVG y-axis labels hardcode `EGP 70k…EGP 40k` (lines 212-215), tooltip hardcodes `EGP 62,400` (line 234), cold-chain share hardcodes `EGP 18,400` (line 191). No "Expiry exposure by month" panel, no "Top products by value" panel. MetricTile rows have no `data-minor`/`coverage-table` testids (e2e `analytics.spec.ts` expects them). Missing i18n keys referenced: `deliveries.col.vehicle`, `deliveries.col.driver`, `deliveries.panel.proofsTitle`, `deliveries.panel.proofsSubtitle` don't exist in `i18n/messages/en.json`.
- Fix: build charts from `batches`/`stock_balances` real values (metric tiles = sum of `unit_cost_minor * qty_on_hand`, ranked by value); add missing expiry exposure + top-products panels; add `inventory-value`/`coverage-table` testids; add missing keys to `en.json`/`ar.json`; wire `range` searchParams properly.

**D9. Catalogue (products) — search/form/filters inert, `?edit=new` ignored.**
- Evidence: `admin/inventory/products/page.tsx` has `defaultValue={query}` search input with NO `<form>` (line ~151), `name="q"` but pressing Enter does nothing; three `<select>` filters with no `onChange`/form; `ProductForm`/`LocationForm`/`Toolbar` gone; `href="/admin/inventory/products?edit=new"` (line 99) and `?edit=${p.id}` (line 259) go nowhere — `searchParams` only reads `q`. Fake subtitle `· Node 04 Central Hub` (line 68).
- Fix: wrap search+filters in `<form action={...}>` (server action) or client handler; restore `ProductForm`/`LocationForm` from `products/actions.ts`; honour `?edit=new` (new product) and `?edit=<id>` (edit). Use real data only.

**D10. Requisitions — allocate/release/approve/reject/new all inert; fake batch id.**
- Evidence: `admin/inventory/requisitions/page.tsx` fake batch id `CAI-2026-N04` (line 95), no `NewRequisitionForm`, no line editor, no submit/approve/reject forms, `RemoveLineButton` unused, `?inspect` anchor dead.
- Fix: restore `RequisitionQueue`, `NewRequisitionForm`, `RequisitionLineEditor`, `RemoveLineButton`; wire to `requisitions/actions.ts` (`submitRequisition`, `approveRequisition`, `rejectRequisition`). Read real `searchParams`.

**D11. Stocktake — count sheet gone; `countedQty`/`diffQty` always empty; all buttons inert.**
- Evidence: `admin/inventory/stocktake/page.tsx` lines 90-91 initialize empty maps → every line shows counted 0 / diff = negative expected. Fixed header at line 120 (`fixed top-0`) nests inside shell header. `CountSheet` exists at `components/stocktake/count-sheet.tsx` and `submitStocktakeAction` at `stocktake/actions.ts` — both unused.
- Fix: restore `CountSheet` wired to `submitStocktakeAction`; remove fixed header.

**D12. Pharmacy — requisition queue gone; quick-action links point at `/admin/*` which PHARMACY_MANAGER cannot reach.**
- Evidence: `pharmacy/page.tsx` links `/admin/inventory/requisitions` (line 271), `/admin/deliveries` (line 278), `/admin/alerts` (line 285), plus catalogue/batches/admin/alerts in nav bar (lines 81-90). `ROLES_BY_SURFACE.pharmacy` excludes these (admin only), so they 404/`notFound`. Fake facility name `Al-Amal Clinical Pharmacy · Dokki Hub` lives in `i18n/messages/en.json` as `pharmacy.title` — fabricated; must come from facilities table. No `RequisitionQueue` (was used before rebuild `c1773a4`).
- Fix: restore `RequisitionQueue`; replace `/admin/*` links with pharmacy-surface equivalents or remove; load facility name from DB; i18n fix: `t('pharmacy.title')` at line 129 resolves `pharmacy.pharmacy.title` — change to `t('title')` (real key: `Your pharmacy`).

**D13. Driver — arrive/fail/signature/run-controls/live-position/map gone.**
- Evidence: `driver/page.tsx` has zero `onClick`/`form`; `ArriveButton`, `FailStopForm`, `SignSheet`, `RunControls`, `LivePositionReporter`, `DeliveryMap`, `ServiceWorkerRegistration` were removed at rebuild `84eca13`.
- Fix: restore all six wired to `driver/actions.ts` (`startTripAction`, `arriveAtStopAction`, `completeStopAction`, `failStopAction`, `completeTripAction`).

**D14. Distributor — dead links to `/admin/*`; hardcoded "DISPATCHER" badge; inert buttons.**
- Evidence: `distributor/page.tsx` links `/admin/inventory/batches` (141), `/admin/deliveries` (147), `/admin/inventory/requisitions` (153), `/admin/inventory/batches` (297), `/admin/alerts` (389) — DISTRIBUTOR cannot reach admin. Badge says "DISPATCHER" hardcoded (line 116). Buttons "EDA Portal Sync" / "العربية" / notifications (lines 160-169) do nothing.
- Fix: remove admin links (distributor surface owns its own destinations); badge must read `session.role` real value; wire buttons or remove them.

### P1 — Missing routes / dead links

**D15. `/admin/audit` is advertised but missing (404).**
- Evidence: nav key `audit` disabled for analyst in `components/app-nav.tsx`; dashboard footer links `/admin/audit` (`admin/page.tsx`, line ~424); no `admin/audit/page.tsx` exists; `lib/audit-labels.ts` + `AuditLogEntry` helpers orphaned; `audit_logs` table exists (migration `000003_audit.sql`).
- Fix: build `admin/audit/page.tsx` listing `audit_logs` via `getSupabase()`, labelled with `labelEntities`/`translateEntityType`/`describeAction`. Or remove footer link and disable nav item cleanly (keep disabled + explain).

**D16. Distributor `routes` page missing (nav item disabled).** `pharmacy/requisitions` route missing (nav item pending). These are advertised as disabled, not 404 — lower severity; either build or mark "not yet built" with a disabled state and no link.

### P2 — Layout / overflow / typography

**D17. `xl:grid-cols4` typo** — invalid Tailwind class at `admin/inventory/page.tsx:258`; stat cards never render 4-wide on desktop.
- Fix: `xl:grid-cols-4`.

**D18. Invalid utility classes do nothing:** `font-body-md` (21×), `font-body-sm` (4×), `text-body-sm` (2×), `font-cairo` (5×). No `--font-body*`/`--text-body*` tokens exist in `globals.css @theme`.
- Fix: replace with defined token classes (`font-display`, `font-latin`, `font-mono`, `text-xs`/`text-sm`/`text-base`) or define tokens.

**D19. `min-h-[100dvh]` on page roots inside shell** (most rebuilt pages) causes extra viewport height / overflow.
- Fix: remove; shell owns height.

### P3 — i18n / copy

**D20. Namespace double-prefix bugs** (verified by grep + manual check): `alerts.allClear` → `alerts.alerts.allClear`; `pharmacy.title` → `pharmacy.pharmacy.title`; `alerts.mode.needsAction`/`mode.resolved` (undefined) used at lines 137/140 with translator `t` (alerts ns) — they read `alerts.mode.*` which doesn't exist.
- Fix: change call sites to `t('allClear')`/`t('allClearHint')`, `t('title')`, `t('mode.needsAction')` using the correct translator (`tNav` where intended).

**D21. Hardcoded English strings in JSX** (never translated): dashboard "Node 04 Central Hub", alerts "OPS CONSOLE", hub "CHAMBER:", "Emergency Quarantine", settings labels case, delivery "CLT", "OCT 21, 2026", etc.
- Fix: wrap in `t()`/`tNav()` or move to messages.

### P4 — Fake / fabricated data (presented as real)

**D22.** `Node 04 Cairo Central` — alerts:71, deliveries:94, distributor:122. `Node 04 Central Hub` — products:68. `Ambient Aisle 1` — dashboard:94. `EDA Lic. GZ-7704` — alerts:112. Proof rows `Orchard Branch Pharmacy`/`Al-Amal Clinical Center`/`Misr Central Pharmacy`, `Ring Road Sector 4 • 48 km/h`, `11:42`, `7e2f-90a1-c884`, `2.8 °C` — deliveries:323-400. `CAI-2026-N04` — requisitions:95. Landing rail `PH-1006` lots — `page.tsx:56`. Analytics y-axis/tooltip/cold-chain — analytics:191-234. `pharmacy.title` fake facility name in messages.
- Fix: replace every one with values read from the database, or remove the panel/figure. No fabricated operational data may be presented as live.

### P5 — Misc

**D23. Dead `href="#"` links** — `admin/page.tsx:418,421` (diagnostics/support); `page.tsx:122,231,256` (landing `#capabilities`); `deliveries:327/338/349` (`#proof-stop-*` in-page anchors with no targets); `requisitions:194` (`#inspect`); `stocktake:307/314/321/329` (`#stocktake` etc.); `admin/inventory:243/249` fine.
- Fix: give real hrefs or remove.

**D24. `bar-trend-chart`/`ranked-bars` testids on plain `<div>`s** (uncommitted testid hacks, admin/page.tsx:182,343) — fake testids to satisfy analytics e2e while the real charts were removed.
- Fix: restore real `charts.tsx` panels (`bar-trend-chart`, `ranked-bars` testids) or remove the fake testids.

**D25. E2E failures** — 5 tests: `alerts.spec.ts` ×3 (scan, ack/resolve, alert-list), `auth.spec.ts` pharmacy+driver (double nav strict-mode). See D3/D6/D13 fixes.

**D26. Signup/setup redirect hardcodes `/admin`** (`signup-form.tsx:139`, `setup-form.tsx:73,81`) — use `homeRouteForRole(role)` (role is TENANT_ADMIN for both, so same result, but consistent).

**D27. Console dock labels hardcoded English** (`components/console-dock-nav.tsx:34-40`) — not translated; Arabic shows English labels.
- Fix: translate via `useTranslations('nav')`.

---

# Part 2 — Execution plan (ordered tasks)

**Task A1 — Google OAuth redirect (D1, D2).**
Files: `google-signin-button.tsx`, `app/auth/callback/route.ts`, `app/[locale]/page.tsx` (landing redirect-if-signed-in).
Verify: sign in with Google as TENANT_ADMIN → lands on `/en/admin`; as PHARMACY_MANAGER → `/en/pharmacy`; as DRIVER → `/en/driver`. `next=/en/admin/inventory` deep link honored.

**Task B1 — Remove duplicate headers/landmarks/h1 (D3, D4, D5).**
Files: 7 page files + `signup-form.tsx` + `setup-form.tsx` + `auth/auth-shell.tsx` (keep single h1).
Verify: one `<header>`, one `<main>`, one `<h1>` per authenticated page; `header.spec.ts` passes at all widths; no horizontal overflow (`scrollWidth <= innerWidth`).

**Task C1 — Alerts (D6).** Files: `admin/alerts/page.tsx`. Restore `AlertScanButton` + `AlertList`, real `alert_events` data, i18n namespace fixes.

**Task C2 — Deliveries (D7).** Files: `admin/deliveries/page.tsx`. Restore forms/map/run selection; real proofs.

**Task C3 — Analytics (D8).** Files: `admin/analytics/page.tsx`. Real charts from DB; missing panels; missing i18n keys added; `inventory-value`/`coverage-table` testids.

**Task C4 — Catalogue (D9).** Files: `admin/inventory/products/page.tsx`. Form-wrapped search/filters; `?edit=new` and `?edit=id` honoured; ProductForm/LocationForm.

**Task C5 — Requisitions (D10).** Files: `admin/inventory/requisitions/page.tsx`. Queue + line editor + submit/approve/reject.

**Task C6 — Stocktake (D11).** Files: `admin/inventory/stocktake/page.tsx`. CountSheet + submitStocktakeAction; remove fixed header.

**Task C7 — Pharmacy (D12).** Files: `pharmacy/page.tsx`. RequisitionQueue; remove `/admin/*` links; real facility name; i18n namespace fix.

**Task C8 — Driver (D13).** Files: `driver/page.tsx`. Restore all delivery components wired to `driver/actions.ts`.

**Task C9 — Distributor (D14).** Files: `distributor/page.tsx`. Remove admin links; real role badge; wire/remove inert buttons.

**Task D1 — Missing routes (D15, D16).** Build `admin/audit/page.tsx` or remove advertised links.

**Task E1 — Layout/typography (D17-D19).** `xl:grid-cols-4`; replace invalid utility classes; remove `min-h-[100dvh]`.

**Task F1 — i18n/copy (D20-D21, D22 fake-data cleanup).** Add missing keys (`deliveries.col.vehicle/driver`, `panel.proofsTitle/Subtitle`, `pharmacy.*` real ones); fix namespace calls; translate hardcoded English strings.

**Task G1 — Misc links/testids (D23-D24).** Real hrefs; real charts/testids or remove fakes.

**Task H1 — Verification.** `make check`, `make typecheck`, `make lint`, `make build`, `make test`, `make e2e` (5 previously failing must pass). Lighthouse mobile + desktop, document before/after in `docs/perf-2026-10-21.md`. Screenshots 1440×900 / 834×1112 / 390×844 all pages, design vs app pairs.

---

# Acceptance gates (copy-paste checklist)

- [ ] `make check` exits 0 (i18n keys, spacing 4px grid, no secrets).
- [ ] `make typecheck`, `make lint`, `make build` green.
- [ ] `make test` green; e2e 36/36 pass (alerts ×3 fixed, auth pharmacy/driver fixed).
- [ ] One `<header>`, one `<main>`, one `<h1>` on every authenticated page.
- [ ] No `scrollWidth > innerWidth` at 1440×900, 834×1112, 390×844.
- [ ] Google sign-in lands on role home; `next` deep link honored.
- [ ] No fabricated operational data anywhere (grep for the known fakes returns nothing).
- [ ] No language switcher in any header.
- [ ] `make e2e` screenshots captured at the three viewports, app vs design pairs.

---

When you're ready, I can execute this plan natively or split it across subagents (one per task group A/B/C/D/E/F/G/H). Say which.