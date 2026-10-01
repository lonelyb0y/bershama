/**
 * PostCSS, for one reason: Tailwind v4 is a PostCSS plugin, and without this file
 * the `@import "tailwindcss"` in globals.css is inert.
 *
 * ── what was actually broken ─────────────────────────────────────────────────
 * tailwindcss and @tailwindcss/postcss were both already in package.json, and the
 * components were written against Tailwind's utility names -- 236 usages of
 * `rounded-xl`, `p-5`, `text-sm`, `flex`, `gap-2` and their neighbours across the
 * application. With no PostCSS step, none of them compiled to CSS. Every one of those
 * elements was rendering with no utility styling at all: cards were not padded,
 * buttons were not rounded, grids were not grids, spacing was flat.
 *
 * That is the whole reason the site looked unfinished, and it was not a design
 * decision anywhere. It was a missing four-line file, sitting next to a dependency
 * that had already been installed and never wired.
 *
 * Nothing else goes through PostCSS: Next.js handles CSS modules and font loading
 * itself, and adding a second transform here would only make the build slower to
 * explain.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
