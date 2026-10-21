# Project Vision & Constitution — Bershama

## 1. Core Identity

**Bershama** (برشامة) is a B2B platform connecting pharmaceutical **distributors** with
**pharmacies** across Egypt. It covers the two jobs that sit either side of the same
transaction:

- **The distributor** holds stock that expires. They need to know what is about to go off,
  where it is, and what it is worth, before the write-off rather than after it.
- **The pharmacy** orders against a catalogue. They need to know what has been allocated,
  what is in transit, and when it will land.

**Domain:** `bershama.eu.org` · **Market:** Egypt · **Language:** English and Arabic (RTL) ·
**Stack:** Next.js 16 (App Router) + React 19, Supabase (Postgres + RLS), Tailwind v4,
`next-intl`.

**Team slogan:** `لو شغل متتزاكاش` — "if it were easy, it wouldn't be a task." It belongs
on the splash, in the loader, and as a bold footer mark. Never as a UI label.

**Tone:** B2B, operational, technically confident. Not friendly-medical. The user is a
warehouse supervisor or a pharmacy owner with a phone in one hand and a list in the other.

## 2. Visual Language (Stitch Prompt Strategy)

Full specification in `.stitch/DESIGN.md` Section 6. The short version:

- Near-black `#121212` ground, warm bone-white ink, **one** accent: Signal Cyan `#22D3EE`.
- Space Grotesk display, Plus Jakarta Sans body, JetBrains Mono for every number,
  IBM Plex Sans Arabic for RTL.
- Cockpit Dense (8), grid-strict, spring physics, staggered fade-ups.
- Status is colour **plus shape plus word**, always.

**Why cyan and not earth tones:** the accent has to be unmistakable against the three
status colours. An amber accent next to an amber expiry warning is a safety bug in a
product where a near-miss costs a pharmacist a batch.

## 3. Architecture & File Structure

The site is the existing Next.js application in `apps/web` — not a static export. The Stitch
loop generates the *design*; the design is then implemented as React components against the
live application, so every screen keeps its real data, its real auth, and its real RLS.

```
apps/web/src/
├── app/[locale]/          # routes
│   ├── page.tsx           # landing
│   ├── login/ signup/ setup/
│   └── admin/             # inventory, requisitions, deliveries, analytics, alerts
├── components/ui/         # the design system: data-table, stat-tile, badge, ...
└── lib/                   # supabase clients, session, i18n
.stitch/
├── DESIGN.md              # the visual specification
├── SITE.md                # this file
├── metadata.json          # Stitch project + screen ids
├── next-prompt.md         # the baton
└── designs/               # generated HTML + PNG per page
```

## 4. Live Sitemap (Current State)

| Page | Route | Status | Notes |
|---|---|---|---|
| Landing | `/[locale]` | [x] | Split hero, two audiences, no centred block |
| Inventory Dashboard | `/[locale]/admin/inventory` | [x] | Figures, expiry bands, low stock |
| Product Catalogue | `/[locale]/admin/inventory/products` | [x] | Real table, named row actions |
| Batches & Expiry | `/[locale]/admin/inventory/batches` | [x] | Days-to-expiry always populated |
| Requisitions | `/[locale]/admin/inventory/requisitions` | [x] | Needs-action queue with a denominator |
| Deliveries | `/[locale]/admin/deliveries` | [x] | Runs, vans, drivers |
| Driver Run | `/[locale]/driver` | [x] | The phone surface |
| Pharmacy | `/[locale]/pharmacy` | [x] | Their own requisitions |
| Analytics | `/[locale]/admin/analytics` | [x] | Every chart has a table twin |
| Sign in | `/[locale]/login` | [x] | Action is the heading, brand is a mark |
| Sign up | `/[locale]/signup` | [x] | |
| Setup | `/[locale]/setup` | [x] | |

## 5. The Roadmap (Backlog)

### High Priority

- [x] **Dark-first re-skin** — the token set now moves to the near-black canvas, the
      media-query fallback and the explicit `.dark` block share one generated list so
      they cannot drift, and dark is the default rather than a preference to be
      discovered.
- [x] **The slogan** — `لو شغل متتزاكاش`, set large in the display face in the footer.
- [x] **Spring motion layer** — one shared vocabulary in `globals.css`: a reveal, a
      stagger, a breathing live dot, a skeleton sweep. Transform and opacity only, and
      all of it stands down under `prefers-reduced-motion`.
- [x] **The type** — Inter is gone. Space Grotesk, Plus Jakarta Sans, JetBrains Mono,
      and IBM Plex Sans Arabic for the RTL surface.
- [x] **Every string goes through the message files** — the landing page's status
      labels and nav were string literals and English defaults written into
      `ar.json`. No key was missing, so no checker could see it. The days are an ICU
      plural now, because Arabic has six of them.
- [ ] **The sign-in screen** — the design exists (`.stitch/designs/auth.*`); the page is
      still the old one. Split layout, fields with labels above them, the operations
      panel on the right.
- [ ] **The inventory console** — the design exists (`.stitch/designs/inventory.*`);
      the page has the primitives but not the composition.
- [ ] **The deliveries console** — the design exists (`.stitch/designs/deliveries.*`).

### Medium Priority

- [x] **Staggered dashboard reveal** — `.pf-stagger`, 60ms per step, capped at eight.
- [x] **Chart palette re-derivation** — the series ramp leads with the accent and ends
      on a neutral, so a five-series chart never invents a hue.
- [x] **Arabic resolves to the specified face** — IBM Plex Sans Arabic now sits in every
      font stack, not only the Arabic one. Font fallback is per character, so a
      display heading was resolving its Latin glyphs from Space Grotesk and its
      Arabic glyphs from the operating system. Measured: 220.1px under the old
      stack against 181.8px under IBM Plex Sans Arabic.
- [ ] **Arabic optical sizing** — Arabic at the same pixel size reads smaller than Latin
      beside it; the Arabic ramp gets a small bump.
- [ ] **The splash** — the slogan is in the footer; it also belongs on the boot screen.

## 6. Creative Freedom Guidelines

Anything that helps a distributor or a pharmacist finish their job faster is fair game.
The constraint is density and legibility, not novelty.

### Ideas to Explore

- [ ] A **live run board** for the dispatcher — every van, its stops, its last known position.
- [ ] **Batch genealogy** — trace a lot forward and backward through the ledger.
- [ ] **FEFO picking list** — the order a picker should physically work in.
- [ ] **Expiry exposure by facility** — value at risk, per warehouse.
- [ ] **Offline stocktake mode** as a first-class screen rather than a fallback.
- [ ] **A public price-and-availability lookup** for a pharmacy, without an account.

## 7. Rules of Engagement

1. **Real data only.** Every number on a screen comes from the database or from a
   clearly-marked placeholder. Never invent a metric, an uptime figure or a growth
   percentage.
2. **Never colour alone.** Status is colour, shape and word — every time.
3. **One accent.** Signal Cyan. Nothing else gets to be the accent.
4. **Density is a feature.** 36px rows, 13px type, monospace numerals.
5. **RTL is not a mirror of LTR.** The Arabic surface is a first-class design, and Latin
   numerals stay Latin for identifiers.
6. **The tap target is 44px.** Always. Including in tables.
7. **The work is real.** Every screen in this application writes to a regulated ledger.
   A design that suggests an action the database would refuse is a broken design.
8. **Reuse the primitives.** `components/ui/` is the system. A screen that rolls its own
   list is the defect this whole redesign was for.
