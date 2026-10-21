import createNextIntlPlugin from 'next-intl/plugin';

// next-intl needs this plugin to resolve the request config both in the server
// components and the proxy.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl({
  // Typed routes catch a mistyped href at build time. On by default in Next 16
  // once the plugin is configured.
  typedRoutes: true,

  /*
   * ── images ──────────────────────────────────────────────────────────────────
   *
   * AVIF first, then WebP, then the original. AVIF is roughly half the size of
   * WebP at the same perceived quality, and WebP is roughly a third of a PNG --
   * and this product's images are product photography, which is exactly the case
   * the modern codecs were made for.
   *
   * The one-year cache is safe for a hashed filename, which is what `next/image`
   * produces: the URL changes when the bytes do.
   */
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60 * 60 * 24 * 365,
  },

  /*
   * ── caching ────────────────────────────────────────────────────────────────
   *
   * Vercel already serves `/_next/static/**` immutably, and the hashed chunks
   * under it are the bulk of the page. What was NOT covered is everything else
   * with a versioned name -- the fonts, the icons, the manifest.
   *
   * A year is the right answer for a hashed file and the wrong answer for
   * anything else, so the rule is narrow: one year for a path that carries a
   * hash in it, and a short, revalidated life for everything else.
   */
  async headers() {
    return [
      {
        // The build output. The filename is a content hash, so the bytes behind
        // this URL cannot change.
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // The fonts. `next/font` emits a content-hashed file name too.
        source: '/_next/static/media/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },

  experimental: {
    /*
     * ── package imports ──────────────────────────────────────────────────────
     *
     * `motion` in particular is a large package with a large public surface, and
     * a barrel import pulls the whole of it into the graph. Rewriting the
     * import to the specific entry points cuts what the bundler has to walk.
     */
    optimizePackageImports: ['motion', 'motion/react', '@bklit/line-chart'],
  },
});
