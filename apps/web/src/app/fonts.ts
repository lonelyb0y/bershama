import localFont from 'next/font/local';

// Fonts are self-hosted rather than fetched from Google while the build runs.
//
// ── why ──────────────────────────────────────────────────────────────────────
//
// `next/font/google` downloads the stylesheet and the woff2 files during the
// build. Google Fonts intermittently answers with an extensionless
// `fonts.gstatic.com/l/font?kit=...&skey=...` URL, and Next.js 16 cannot parse
// it. The Turbopack build then fails with
//
//     Module not found: Can't resolve
//       '@vercel/turbopack-next/internal/font/google/font'
//     next/font/google queries have exactly one entry
//
// (vercel/next.js#99114, still open on 16.3.6). The result is a build that
// depends on a third party and can fail on a commit that changed nothing.
//
// The files in `./fonts` are the exact woff2 payloads Google served for the
// previous configuration. `next/font/local` emits the same @font-face rules and
// the same CSS variables, so the rendered result is unchanged -- but the build
// no longer makes an HTTP request.
//
// IBM Plex Sans Arabic carries proper Arabic letterforms; the system fallback
// renders Arabic with incorrect joining in several browsers.

export const outfit = localFont({
  src: './fonts/outfit-latin.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-outfit',
});

export const nunitoSans = localFont({
  src: './fonts/nunito-sans-latin.woff2',
  weight: '200 1000',
  display: 'swap',
  variable: '--font-nunito',
});

export const cairo = localFont({
  src: './fonts/cairo-arabic.woff2',
  // The file is the variable font Google served for 400, 600 and 700.
  weight: '400 700',
  display: 'swap',
  // Not preloaded. Cairo is only used on the Arabic page, and a preload is a
  // request the English page pays for and never uses. `swap` covers the gap.
  preload: false,
  variable: '--font-cairo',
});

export const jetbrainsMono = localFont({
  src: './fonts/jetbrains-mono-latin.woff2',
  weight: '100 800',
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

export const plexArabic = localFont({
  src: [
    { path: './fonts/plex-arabic-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/plex-arabic-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/plex-arabic-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/plex-arabic-700.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
  // The fallback for Cairo, and only used when a glyph is missing from it.
  // Preloading it would be a second Arabic font on every page.
  preload: false,
  variable: '--font-plex-arabic',
});
