# Design System: Bershama

## 1. Visual Theme & Atmosphere

A **night-shift operations console** for the Egyptian pharmaceutical supply chain. Near-black, dense,
high-signal, and completely uninterested in looking like a hospital website. Every pixel is either
data or a control; nothing decorates.

**Density: 8 (Cockpit Dense).** A warehouse supervisor is reading forty batches looking for one
expiry date, and a pharmacy owner is scanning a catalogue for a SKU. The layout earns its density
from hierarchy — weight, colour and numerals — not from more whitespace.

**Variance: 4 (Predictable Symmetric, with deliberate asymmetry at the hero).** Operations screens
are grid-strict and symmetrical. Marketing surfaces break the grid once, deliberately.

**Motion: 7 (Fluid CSS).** Spring-physics and staggered reveals. The data should feel like it is
arriving, not blinking into existence.

**Reference feeling:** the control room of a modern logistics terminal at 2am. Warm paper-white text
on cold charcoal, one live cyan signal, and colour reserved almost entirely for danger.

## 2. Color Palette & Roles

### Surfaces (cool, near-black, one warm note in the ink)

- **Off-Black Canvas** `#121212` — the page ground. Never pure black; pure black makes the
  charcoal panels read as holes.
- **Raised Slate** `#1A1A1C` — panels, the sticky header, the table shell.
- **Lifted Graphite** `#232326` — hovered rows, nested surfaces, table header bands, inputs.
- **Deep Well** `#0D0D0E` — recessed areas: the code strip, the empty-state well, a table's
  footer band.

### Ink (warm, so the neutrals do not feel clinical-dead)

- **Bone White** `#F2EFE9` — primary text. A paper tint, not a blue-white.
- **Ash Grey** `#A1A1AA` — secondary text, metadata, units.
- **Dim Slate** `#5C5C66` — tertiary, disabled, axis labels.

### Structure

- **Hairline** `rgba(255,255,255,0.08)` — 1px borders, table rules, dividers.
- **Hairline Strong** `rgba(255,255,255,0.14)` — focused or selected container edges.

### The single accent

- **Signal Cyan** `#22D3EE` — primary CTAs, the active navigation item, focus rings, the
  primary data series, live indicators.

  Cyan rather than the earth tones, and the reason is a safety one. This product shows three
  status colours — expired, expiring, in-date — and the accent must not be mistakable for any of
  them. An amber or terracotta accent sits next to an amber expiry warning and a person
  triaging at speed reads the wrong one. The warmth the brief asked for lives in the ink
  instead, where it cannot be confused with anything.

### Status (never an accent, never colour alone — always a shape and a word)

- **Vital Red** `#F2555A` — expired, critical, quarantined. Shape: triangle.
- **Caution Amber** `#F5A524` — expiring soon, low stock, needs a decision. Shape: circle.
- **Stable Green** `#3ECF8E` — in date, delivered, settled. Shape: diamond.
- **Slate Neutral** — everything else. Shape: square.

Status is carried three ways at once: the colour, the glyph shape, and the literal word.
This survives a colour-blind operator, a sunlit phone, and a greyscale printout that a QA
inspector signs.

## 3. Typography Rules

- **Display:** **Space Grotesk** — track-tight (`-0.02em`), weight-driven hierarchy. Never
  oversized; a 32px headline in a dark cockpit reads as shouting.
- **Body:** **Plus Jakarta Sans** — relaxed leading (1.55), 65ch maximum measure, Ash Grey for
  anything that is not the primary fact.
- **Mono:** **JetBrains Mono** — and **every number on a dense screen is monospace**, because
  a column of proportional digits is a column that does not line up and cannot be scanned.
- **Arabic:** **IBM Plex Sans Arabic** — for the full RTL surface. Same scale, same weights,
  slightly larger optical size, and Latin numerals kept for SKUs, lot numbers, quantities and
  timestamps.
- **Banned:** `Inter`. Generic serifs. Any system font stack presented as a design decision.

Scale: 11 / 12 / 13 / 15 / 18 / 24 / 32 / 44px. Line heights 1.35 for display, 1.55 for
body, 1.4 for numerals.

## 4. Component Stylings

- **Buttons:** Flat, no outer glow, no neon. Primary is a solid Signal Cyan fill with
  Off-Black text; secondary is a Hairline outline; destructive is Vital Red as a hairline
  outline until hovered, then a 12% Vital Red wash. Tactile: `-1px` translate on active,
  120ms. Radius 10px, height 36px dense / 44px on touch.
- **Cards:** Radius 16px, `Raised Slate` fill, Hairline border, and a shadow tinted to the
  background hue rather than to black. On dense surfaces, a card is replaced by a
  border-top divider or negative space — a border is cheaper and reads as data, not as a
  box around data.
- **Tables:** The workhorse. 36px rows on desktop, 13px type, monospace numerals,
  right-aligned figures, `Lifted Graphite` header band, Hairline rules, and the sticky
  header pinned under the app bar. A row's interactive controls appear on hover and on
  focus, so a quiet screen stays quiet.
- **Inputs:** Label above, never placeholder-as-label. 44px minimum height. Focus ring is
  Signal Cyan at 2px with a 2px offset. Error text below in Vital Red, tied by
  `aria-describedby`.
- **Loaders:** Skeletal shimmer matching the exact layout dimensions. No circular spinners
  anywhere.
- **Empty states:** Composed. A well, an icon, one sentence on what is missing, and the one
  action that fills it.
- **Status badges:** Pill, 11px, 1px border in the status colour at 40%, text in the status
  colour, the shape glyph before the word.

## 5. Layout Principles

- Grid first. CSS Grid, never flexbox percentage arithmetic.
- Contained to a 1400px measure, centred.
- The nav is a single row that scrolls horizontally below `lg`; it never wraps, and it never
  grows a second row inside a fixed-height header.
- Below 768px everything collapses to one column. No exceptions, and **no horizontal
  overflow** — a sideways-scrolling page on a phone is a critical failure.
- Full-height surfaces use `min-h-[100dvh]`, never `h-screen`.
- Section gaps: `clamp(3rem, 8vw, 6rem)`.
- The hero is a split screen, left-aligned, never centred.
- Feature blocks are a 2-column zig-zag or a horizontal scroll strip. **Never three equal
  cards in a row.**

## 6. Design System Notes for Stitch Generation

Copy this block verbatim into every generation prompt.

```
DESIGN SYSTEM — Bershama (apply exactly, no substitutions)

ATMOSPHERE
A night-shift operations console for an Egyptian pharmaceutical supply chain.
Near-black, dense, high-signal, modern and slightly disruptive. Not a medical
website. Every pixel is either data or a control.

COLOUR — use these exact hex values
  Off-Black Canvas   #121212   page background
  Raised Slate       #1A1A1C   panels, header, table shell
  Lifted Graphite    #232326   hovered rows, header bands, inputs
  Deep Well          #0D0D0E   recessed strips
  Bone White         #F2EFE9   primary text
  Ash Grey           #A1A1AA   secondary text, metadata
  Dim Slate          #5C5C66   tertiary, disabled
  Hairline           rgba(255,255,255,0.08)   borders, rules
  Signal Cyan        #22D3EE   the ONLY accent — CTAs, active nav, focus, primary data
  Vital Red          #F2555A   expired, critical  (shape: triangle)
  Caution Amber      #F5A524   expiring soon, low stock (shape: circle)
  Stable Green       #3ECF8E   in date, delivered (shape: diamond)

TYPOGRAPHY
  Display  Space Grotesk, tracking -0.02em, weight-led hierarchy, never oversized
  Body     Plus Jakarta Sans, line-height 1.55, max 65ch measure
  Mono     JetBrains Mono — ALL numbers on dense screens are monospace
  Arabic   IBM Plex Sans Arabic, RTL, Latin numerals for SKUs, lots, quantities
  Scale    11 / 12 / 13 / 15 / 18 / 24 / 32 / 44px

COMPONENTS
  Buttons   flat, no outer glow, 10px radius, 36px dense / 44px touch,
             -1px translate on active, primary = Signal Cyan fill on Off-Black text
  Tables    36px rows, 13px type, mono right-aligned numerals, Lifted Graphite header
             band, hairline rules, sticky header, row actions on hover and focus
  Cards     16px radius, Raised Slate fill, hairline border, shadow tinted to the
             background hue; on dense surfaces use a border-top divider instead
  Inputs    label above (never placeholder-as-label), 44px min height, 2px cyan focus ring
  Loaders   skeletal shimmer matching exact layout dimensions, never a spinner
  Badges    11px pill, 1px border, shape glyph then the word

LAYOUT
  Grid-first, 1400px max measure, centred. Hero is a split screen, left-aligned,
  never centred. Feature blocks are a 2-column zig-zag or a horizontal scroll strip.
  Never three equal cards in a row. Single column below 768px with no horizontal
  overflow. Full-height surfaces use min-h-[100dvh], never h-screen.

MOTION
  Spring physics by default (stiffness 100, damping 20). Staggered fade-up reveals
  for dashboard data cards. Perpetual micro-loops on live indicators and skeleton
  shimmer. Animate transform and opacity only, never top/left/width/height.

NEVER
  No emojis. No Inter. No generic serif. No pure black #000000. No neon or outer glow
  shadows. No gradient text on large headings. No custom cursors. No overlapping
  elements. No three-equal-card rows. No centred hero. No circular spinners. No
  "Scroll to explore" or scroll arrows. No AI copywriting cliches (Elevate,
  Seamless, Unleash, Next-Gen). No generic names (John Doe, Acme, Nexus). No
  fabricated statistics or uptime metrics — use real data or a clear placeholder.
  No "LABEL // YEAR" formatting. No horizontal scroll on mobile.
```

## 7. Anti-Patterns (Banned)

- No emojis anywhere.
- No `Inter`. No generic serif in a dashboard.
- No pure black `#000000`.
- No neon or outer-glow shadows.
- No gradient text on large headers.
- No custom mouse cursors.
- No overlapping elements — every element owns its own zone.
- No three-equal-card rows.
- No centred hero.
- No circular spinners.
- No "Scroll to explore", scroll arrows, bouncing chevrons.
- No AI copywriting clichés: Elevate, Seamless, Unleash, Next-Gen, Supercharge.
- No generic names: John Doe, Acme, Nexus, PharmaCorp.
- No fabricated data, statistics, uptime percentages, response times or deployment
  counts. Real data, or a clearly-marked placeholder.
- No `LABEL // YEAR` formatting.
- No horizontal overflow on mobile.
- No status conveyed by colour alone.
- No pure-black table cells or pure-black card fills.
