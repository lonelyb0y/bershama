---
page: sign-in
---
The sign-in screen for **Bershama**. A variant of the design already in
`.stitch/designs/auth.html`, generated with the field labels **above** the controls,
the checkbox on the left and the "forgot password" link on the right, and a
`Show` toggle inside the password field. Keep the split: the form on the left at
52%, the operations panel on the right at 48%.

**REAL DATA — no invented metrics.** No user counts, no "trusted by", no logos.

**DESIGN SYSTEM (REQUIRED):**
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

**Page Structure:**

1. A slim top bar — `Bershama` wordmark left, and on the right a language switcher
   (English / العربية) and a ghost `Create organisation` link.

2. The split. Left: an 11px uppercase JetBrains Mono eyebrow `PHARMACEUTICAL
   DISTRIBUTION · EGYPT`, an H1 in Space Grotesk 32px `Sign in to Bershama`, and a
   14px Ash Grey line `Distributors and pharmacies, one ledger, and a batch you can
   trace.` The form in a `Raised Slate` panel, 16px radius, hairline border, 24px
   padding: an `Email address` field with the label above it, a `Password` field
   with a `Show` toggle, then a row with a `Remember this device` checkbox and a
   `Forgot password?` link, then one full-width 44px Signal Cyan `Sign in` button,
   then a centred line `New here? Create an organisation`.

   Right: the operations panel, with the three-batch table and the monospace
   footer line.

3. A minimal footer — a hairline top border, and centred in 12px Dim Slate the team
   slogan `لو شغل متتزاكاش`, set in Space Grotesk.

**Never:** a centred card layout, a floating illustration, emoji, invented social
proof, a circular spinner, or a "Sign in with Google" button that is not a real
control.
