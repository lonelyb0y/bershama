import {
  Cairo,
  IBM_Plex_Sans_Arabic,
  JetBrains_Mono,
  Nunito_Sans,
  Outfit,
} from 'next/font/google';
import { type Metadata, type Viewport } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { ThemeInit } from '@/components/theme-init';
import { DeferredAnalytics } from '@/components/deferred-analytics';

import {
  directionOf,
  locales,
  routing,
  type Locale,
} from '@/i18n/routing';

import '../globals.css';

// Fonts are declared with next/font rather than a <link> to Google Fonts.
//
// Beyond removing a render-blocking third-party request, this is a privacy
// decision: a <link> to fonts.googleapis.com tells Google the IP address of every
// doctor and driver who opens the app. next/font downloads at build time and
// self-hosts the files, so no request ever reaches Google at runtime.
//
// IBM Plex Sans Arabic carries proper Arabic letterforms; the system fallback
// renders Arabic with incorrect joining in several browsers.
const outfit = Outfit({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-outfit',
});

const nunitoSans = Nunito_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-nunito',
});

const cairo = Cairo({
  subsets: ['arabic'],
  weight: ['400', '600', '700'],
  display: 'swap',
  // Not preloaded. Cairo is only used on the Arabic page, and a preload is a
  // request the English page pays for and never uses. `swap` covers the gap.
  preload: false,
  variable: '--font-cairo',
});



const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});


const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  // The fallback for Cairo, and only used when a glyph is missing from it.
  // Preloading it would be a second Arabic font on every page.
  preload: false,
  variable: '--font-plex-arabic',
});

export const metadata: Metadata = {
  // Set explicitly, because the Open Graph card resolves its URL against this
  // and Next falls back to http://localhost:3000 without it -- which is a
  // correct-looking absolute URL that is useless to anyone but this machine.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? 'https://pharmaflow-bay.vercel.app',
  ),
  title: {
    default: 'Bershama',
    template: '%s · Bershama',
  },
  description:
    'Pharmaceutical supply chain: batch-level inventory, expiry control, requisitions and live delivery tracking.',
  applicationName: 'Bershama',
  appleWebApp: {
    capable: true,
    title: 'Bershama',
  },
  formatDetection: {
    // Medicine quantities and prices must never be auto-corrected or
    // reformatted by the browser's own detection heuristics.
    telephone: false,
    date: false,
    address: false,
    email: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Left unrestricted: driver phones are used one-handed, and blocking zoom
  // fails accessibility for no real gain.
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0b' },
  ],
};

/**
 * Both locales are prerendered at build time. The page is a shell and the data
 * is per-session, so there is nothing dynamic here to justify skipping it.
 */
export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // A locale outside the allowlist is a 404, not a silent fallback to English:
  // silently serving the wrong direction to an Arabic speaker is a bug.
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Required for static rendering. Without it next-intl warns that it cannot
  // statically render the subtree.
  setRequestLocale(locale);

  const messages = await getMessages();
  const dir = directionOf(locale as Locale);

  return (
    <html
      lang={locale}
      dir={dir}
      // next/font injects its @font-face rules with this class, which exposes the
      // family as a CSS variable. suppressHydrationWarning is required because
      // next/font injects the rules during streaming, after the initial HTML.
      className={`${outfit.variable} ${nunitoSans.variable} ${jetbrainsMono.variable} ${cairo.variable} ${plexArabic.variable}`}
      suppressHydrationWarning
    >
      <body
        // Applying the face by locale, not by direction: a page can be RTL
        // while still containing mostly Latin text (SKUs, GTINs, expiry dates),
        // and those should stay in the Latin face.
        className={locale === 'ar' ? 'font-arabic antialiased' : 'font-latin antialiased'}
      >
        {/* Runs before the first paint; see the note in the component. */}
        <ThemeInit />
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>

        {/*
          Vercel Analytics, first-party: it reports to the deployment the request
          already came from, so no analytics vendor sees a doctor's or a driver's IP
          address. That is the same reasoning as next/font above -- a pharmacy
          application is not where a request to a third party belongs -- and the
          alternative is not "no analytics", it is whichever external tool would
          otherwise be pasted in here.

          mode="auto" follows the deployment: production and previews report, and
          local development does not, which would otherwise fill the dashboard with
          localhost noise.
        */}
<DeferredAnalytics />

          {/*
            Speed Insights, for the same first-party reason as Analytics above: the
            Core Web Vitals of a request never leave the deployment that served it.

            It measures what actually shipped rather than what a lab predicts, which
            matters here for one specific reason: the dashboard carries a WebGL
            backdrop, and a fragment shader that is comfortable on a laptop is a janky
            first contentful paint on a cheap Android in a warehouse. The number that
            exposes it is the field one, and this is the field one.

            No `route` override is passed, deliberately. A layout receives `params`
            and not the pathname, so passing one would need a client component and a
            hydration hop to hand over a string the script reads off the URL anyway.
            Reporting per real URL also keeps /en/admin and /ar/admin as separate
            series -- an English and an Arabic dashboard are different render costs,
            and averaging them hides the case worth seeing.

            No `mode` either, because @vercel/speed-insights 2.0 removed it: the
            component reports only where the Vercel runtime collects it, so local
            development does not need to be opted out of. (Analytics still takes
            mode="auto" -- that prop does exist there.)
          */}
        </body>
    </html>
  );
}
