---
page: implement-the-designs
---

All seventeen designs now exist, on the apothecary system, in
`.stitch/designs/<route>.html` and `.stitch/designs/<route>.png`. The
Stitch project is `3401416261192633237`; the design system asset is
`6705731965464402504`; the screen ids are in `.stitch/metadata.json`.

**The next job is IMPLEMENTATION, not generation.** Every screen in the
designs folder describes a page that exists in the application and does not
yet look like it.

**DESIGN SYSTEM (REQUIRED):** the whole of `.stitch/DESIGN.md` section 6.

**The order, and why it is this order:**

1. **sign-in, sign-up, setup** first. They are public, they are small, and
   every other surface is behind them. The floating label lands here first,
   because these are the three forms a person meets first.
2. **dashboard, inventory-hub, catalogue** next -- the admin console, where
   the Bklit charts and the console dock are.
3. **batches, requisitions, stocktake** -- the warehouse surfaces.
4. **deliveries, analytics, alerts** -- the rest of the console.
5. **pharmacy, driver, distributor, settings** -- the other three surfaces
   and the account page.

**What has already landed, and must not be undone:**

- The palette is in `globals.css` as `:root` (dark, the base) and
  `:root.light` (the opt-in). Both are generated from one list.
- The type is Outfit, Nunito Sans, Cairo and JetBrains Mono.
- The floating label is `components/form.tsx`, and it is on every form.
- The regen icons are vendored in `components/icons/regen.tsx`.
- The marketing header, the console dock and the Vanta home background exist.
- The account settings page exists, and the language left the header.

**The rules that are not negotiable:**

- Real data only. Every number comes from the database.
- A chart keeps its table twin.
- Status is colour, shape and word -- and in-date is NEUTRAL.
- The label lives inside the field.
- Every spacing value is on the 4px grid, and `make spacing` will say so.
- A page that is not implemented must be visited by
  `e2e/list-surfaces.spec.ts` before it ships, because a server component
  that hands a render function to a client component crashes at runtime
  while every type check passes.
