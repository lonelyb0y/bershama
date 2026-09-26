# 0005. Bilingual and RTL from the first commit

Status: Accepted

## Context

The distributor operates in Egypt. Staff read Arabic. Product packaging is
bilingual — a pharmacy orders against what is printed on the carton. Some users
will work in English and some in Arabic, and the correct language is a per-user
preference, not a global setting.

Two costs are easy to underestimate:

**Translating text without mirroring the layout produces something worse than no
translation.** A form that reads right-to-left in Arabic but whose labels, icons
and validation messages sit on the wrong side is harder to use than an English
form, because the user has to re-derive the mapping on every screen.

**Retrofitting RTL is not a styling task.** It touches every component, every
layout, every directional icon, every hardcoded `margin-left`. Done after
launch, it is a re-review of the entire interface. Done first, it is a property
the components have from birth.

## Decision

English and Arabic from the first commit, with RTL as a structural property
rather than a feature.

- `dir` is derived from the locale, on `<html>`, before first paint.
- Spacing uses **logical properties** — `padding-inline`, `margin-inline`,
  `border-inline-start` — so one stylesheet serves both directions with no
  mirrored duplicate.
- Every locale is URL-prefixed (`/ar/...`, `/en/...`) so a deep link is
  unambiguous and switching locale does not lose the page.
- Product records require **both** `name_en` and `name_ar`, and search covers
  both plus SKU, GTIN and ATC code. A single-name product is unusable in an
  Egyptian pharmacy.
- Directional icons are mirrored with a logical transform.
- Arabic-Indic digits are **not** used for data. Numbers stay Latin on Arabic
  pages.

## Consequences

### Positive

- **No retrofit.** Every component has been correct in both directions since it
  was written, because the build fails otherwise.
- **Product data is right the first time.** Requiring both names at the schema
  level means an incomplete catalogue cannot be created and then discovered
  unusable.
- **Search works in both scripts.** A pharmacist can search `بنادول` or
  `Panadol` and get the same result.
- **Numbers are transcribable.** A driver reading an expiry date off a carton
  types Latin digits, because that is what is printed.
- **Arabic renders correctly.** IBM Plex Sans Arabic is loaded through
  `next/font`. The system fallback joins Arabic letters incorrectly in several
  browsers, which is not a cosmetic problem.

### Negative

- **Every component is written twice as carefully.** A developer who thinks in
  LTR has to consciously choose logical properties, and a missed one is a visual
  bug that no type checker catches.
- **Message files double.** Two files that must stay in sync, and a missing key
  falls back to the key rather than failing the build. Worth a check before M5.
- **Arabic is longer.** German-style text expansion does not apply, but Arabic
  translations need to be written by someone who reads the domain, not machine
  translated. Pharmacological terms do not survive automated translation.
- **Fonts cost a download.** Two families, self-hosted. `display: swap` keeps text
  readable while they load, and self-hosting means no request reaches Google.

### Neutral

- **Hijri dates are not stored.** Records stay Gregorian, which is what a
  regulator expects and what matches the packaging. A Hijri display layer can be
  added without a migration, and is a rendering decision rather than a data one.
- **`localeDefault` is per tenant, not per user.** A user-level override is
  supported in `profiles.locale`; the tenant default is only the fallback.
