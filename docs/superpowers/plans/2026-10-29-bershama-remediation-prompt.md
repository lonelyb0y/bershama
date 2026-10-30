# Prompt: remediate Bershama web app (apps/web/)

**Context**
- Repo: https://github.com/lonelyb0y/bershama (local: /home/taha/projects/pharmaflow); app: apps/web/ (Next.js 16, App Router, next-intl, Supabase, Vercel free tier).
- Production domain: https://pharmaflow-bay.vercel.app. Login: verify-hub-1792614256@bershama.test / Bershama#2026 (role TENANT_ADMIN).
- Last commit: fae7237 Fix horizontal overflow on mobile and desktop pages. Working tree dirty on 4 files (leftover data-testid hacks).
- Current state: every rebuilt authenticated page is a static server component with zero <form>/onClick. The e2e Browser job fails 5/36 (alerts.spec.ts ×3, auth.spec.ts pharmacy + driver).

**Task**
Fix every defect below. Reconnect, don't rewrite — all orphaned components and server actions still exist intact on disk:
AlertScanButton, AlertList, ProductForm, ProductTable, LocationForm, RequisitionQueue, NewRequisitionForm, RequisitionLineEditor, RemoveLineButton, CountSheet, NewVehicleForm, NewRunForm, AddStopForm, DispatchForm, ArriveButton, SignSheet, FailStopForm, RunControls, LivePositionReporter, DeliveryMap, ServiceWorkerRegistration.
Server actions still exist: products/actions.ts, requisitions/actions.ts, stocktake/actions.ts, alerts/actions.ts, deliveries/actions.ts, driver/actions.ts.

Present real database data only — no fabricated values presented as live.

**Non-negotiable constraints**
1. Free tier only; Vercel hosting; no Docker for the app; no local Supabase stack for the app.
2. Palette #F6F3EC / #141613 / jade #43B189; light + dark; rounded typography; floating labels INSIDE the box, never above.
3. 4px spacing grid — scripts/check-spacing.mjs must pass.
4. Icons from kazdenc/regen-icons; Bklit charts where charting is required; Vanta.js only on home desktop.
5. No language switcher in any header; language lives on /settings.
6. Google OAuth: resolve the role after code exchange and redirect to homeRouteForRole(role); honor a validated next deep link.
7. Remove per-page <header>/<main>/min-h-[100dvh] wrappers; AuthenticatedShell owns chrome and landmarks; pages keep only a title/action block.
8. Real data only — no Node 04, EGP 62,400, 7e2f-90a1-c884, CAI-2026-N04, PH-1006, fake pharmacies, fake proof rows, hardcoded chart axes.

**Defects to fix**
A1 Google OAuth redirect — components/google-signin-button.tsx (always next=/${locale}), app/auth/callback/route.ts (redirects to /en with no role lookup), app/[locale]/page.tsx (landing does not redirect signed-in users).
B1 Duplicate headers/landmarks/h1 — delete per-page <header>+<main>+min-h-[100dvh] on admin/alerts, admin/deliveries, admin/analytics, admin/inventory/stocktake, distributor, driver, pharmacy; fix duplicate h1 in components/signup-form.tsx and components/setup-form.tsx (AuthShell already renders the single <h1>).
C1 Alerts — app/[locale]/admin/alerts/page.tsx: restore AlertScanButton + AlertList wired to real alert_events; fix i18n namespace (t('alerts.allClear') → t('allClear')); restore scan/ack/resolve/filter behavior.
C2 Deliveries — app/[locale]/admin/deliveries/page.tsx: honor ?new=true and ?run=; restore NewVehicleForm/NewRunForm/AddStopForm/DispatchForm/DeliveryMap wired to deliveries/actions.ts; real proofs only (remove hardcoded Orchard Branch / Al-Amal / Misr Central / Ring Road / 7e2f... / 2.8 °C / 11:42).
C3 Analytics — app/[locale]/admin/analytics/page.tsx: real charts from batches/stock_balances; add missing "Expiry exposure by month" + "Top products by value" panels; add inventory-value/coverage-table testids; add missing i18n keys deliveries.col.vehicle, deliveries.col.driver, deliveries.panel.proofsTitle, deliveries.panel.proofsSubtitle; remove hardcoded EGP values / chart axes.
C4 Catalogue — app/[locale]/admin/inventory/products/page.tsx: wrap search + filters in a form; honor ?edit=new and ?edit=<id>; restore ProductForm + LocationForm wired to products/actions.ts; remove fake "Node 04 Central Hub" subtitle.
C5 Requisitions — app/[locale]/admin/inventory/requisitions/page.tsx: restore RequisitionQueue + NewRequisitionForm + RequisitionLineEditor + submit/approve/reject wired to requisitions/actions.ts; remove fake batch id CAI-2026-N04.
C6 Stocktake — app/[locale]/admin/inventory/stocktake/page.tsx: restore CountSheet + submitStocktakeAction; countedQty/diffQty from real counts (currently always empty); remove fixed header nested inside shell.
C7 Pharmacy — app/[locale]/admin/pharmacy/page.tsx: restore RequisitionQueue; remove /admin/* links (PHARMACY_MANAGER cannot reach admin — 404/403); real facility name from DB instead of fake "Al-Amal Clinical Pharmacy · Dokki Hub"; fix i18n namespace (t('pharmacy.title') → t('title')).
C8 Driver — app/[locale]/admin/driver/page.tsx: restore ArriveButton/FailStopForm/SignSheet/RunControls/LivePositionReporter/DeliveryMap/ServiceWorkerRegistration wired to driver/actions.ts.
C9 Distributor — app/[locale]/admin/distributor/page.tsx: remove /admin/* links; real role badge from session.role (not hardcoded DISPATCHER); wire or remove inert buttons (EDA Portal Sync, العربية, notifications).
D1 Missing route /admin/audit — advertised in nav and dashboard footer but no page exists (404). Build app/[locale]/admin/audit/page.tsx from audit_logs using lib/audit-labels.ts, or remove the advertised link.
E1 Layout — fix xl:grid-cols4 typo → xl:grid-cols-4 (admin/inventory/page.tsx:258); remove invalid classes font-body-md (21×), font-body-sm (4×), text-body-sm (2×), font-cairo (5×); remove min-h-[100dvh] from page roots.
F1 i18n — fix namespace double-prefix bugs (alerts.allClear, pharmacy.title); translate hardcoded English strings; add missing keys.
G1 Misc — real hrefs for href="#" links (dashboard diagnostics/support, etc.); remove fake bar-trend-chart/ranked-bars testid hacks on plain divs (admin/page.tsx:182,343); restore real chart testids or remove fakes.

**Verification (all must pass before claiming done)**
- make check, make typecheck, make lint, make build, make test — all green.
- make e2e — 36/36 pass, including alerts.spec.ts and auth.spec.ts pharmacy/driver.
- One <header>, one <main>, one <h1> per authenticated page.
- document.documentElement.scrollWidth <= innerWidth at 1440×900, 834×1112, 390×844.
- Google sign-in lands on role home (/en/admin, /en/pharmacy, /en/driver); next deep link honored.
- Grep for known fakes returns nothing.
- Lighthouse mobile + desktop; record before/after in docs/perf-2026-10-21.md.
- Screenshots at 1440×900 / 834×1112 / 390×844, all pages, app vs design pairs in /tmp/opencode/shots/{design,app,pairs}/.

**Out of scope (scheduled job, not now)** — Flutter mobile app refactor.

**Definition of done** — every defect resolved, real data wired to existing components/actions, all verification green.