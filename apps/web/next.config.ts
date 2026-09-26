import createNextIntlPlugin from 'next-intl/plugin';

// next-intl needs this plugin to resolve the request config in both the server
// components and the middleware.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl({
  // Typed routes catch a mistyped href at build time. On by default in Next 16
  // once the plugin is configured.
  typedRoutes: true,
});
