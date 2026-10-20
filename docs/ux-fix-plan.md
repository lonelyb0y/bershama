# Plan — UX audit fixes (20 October 2026)

Seven defects from `docs/ux-audit-2026-10-20.md`, in the order they should be
done. Every one is verifiable before it is called done.

## The list

- [x] **1. Inventory hub counts a column that does not exist.**
      `stock_balances` has no `id`, so PostgREST answers 42703 and the count is
      zero. The hub tells a distributor they have no stock.
      → select a real column.

- [x] **2. `inventory.batch` renders as a column header.** Add the key, both
      languages.

- [x] **3. `stocktake.expiringSoon` renders as warning text.** Add the key, both
      languages.

- [x] **4. A missing translation key must fail the build.** New
      `scripts/check-i18n-keys.mjs`, wired into the Makefile and CI. A key that
      does not exist is a key that reaches production as a raw string.

- [x] **5. The sign-in form GETs the password into the URL** when React has not
      hydrated. → `method="post"` to a route that discards it and returns to the
      form. The password must never be in a URL, a history entry or a Referer.

- [x] **6. The navigation wraps at every desktop width** (measured: 2 rows at
      1024/1280/1440/1920) and the second row escapes the fixed 64px header.
      → one scrolling row at every width, with an edge affordance.

- [x] **7. The dashboard reports a false loss** — "−EGP 62K", styled `bad`,
      when no sell prices exist. → no figure, neutral tone.

- [x] **8. Every stocktake line asks for a variance reason** before anything has
      been counted. → the reason appears only once there is a variance.

- [x] **9. The count input is an unlabelled 60px box.** → a placeholder and a
      size you can type into.

## How each is checked

| # | Check |
|---|---|
| 1 | `curl` the count the page makes; Content-Range must be `0-4/5` |
| 2, 3 | `node scripts/check-i18n-keys.mjs` exits 0 |
| 4 | the same script, in CI, on a deliberately broken key |
| 5 | submit the form with JavaScript disabled; the URL must not carry the password |
| 6 | re-run the nav measurement: `navRows` must be 1 at every width |
| 7 | the dashboard screenshot shows no negative margin and a neutral card |
| 8, 9 | the stocktake screenshot shows the reason only on a line with a variance |

## Then

- [x] `make test-db`, `make check`, `make typecheck`, `make lint`, `make build`,
      `pnpm test`
- [x] Re-run `scripts/ux-audit.mjs` and compare against the findings
- [x] Pull request, CI green, merge
- [x] Deploy to production and re-crawl
- [x] Remove the audit tenant and its accounts

## Not in this pass

Findings 9 to 16 in the audit — the catalogue's row layout, the accordion
headers, alert severity legibility, the empty teal panel, the top-products
heading, "EGP 62K", and the mobile overflow affordance beyond the fade. None of
them is wrong, and the catalogue rewrite is a bigger change than belongs beside a
broken count.
