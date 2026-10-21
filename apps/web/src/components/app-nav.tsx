'use client';

// Navigation, scoped to the surface the user is actually on.
//
// Showing every destination with the disallowed ones disabled would be worse
// than omitting them: a driver who can see an "Inventory" link learns that stock
// exists, and a link that always 404s teaches the operator that this software is
// unreliable. The API enforces the same boundaries regardless; this only
// reflects them.

import { useTranslations } from 'next-intl';

import { Link, usePathname } from '@/i18n/routing';
import type { Surface } from '@/lib/roles';
import type { AppRole } from '@/lib/types';

/**
 * The destinations that exist, as a union spelled out once.
 *
 * Spelled out rather than inferred from the table below, because the table is
 * `Record<Surface, ...>`-typed and the key type is needed to type that record. The
 * alternative -- letting the table infer itself -- means a surface with no entries
 * cannot be written at all, which is the wrong thing to fail on.
 */
type NavKeySource =
  | 'dashboard'
  | 'inventory'
  | 'catalogue'
  | 'batches'
  | 'stocktake'
  | 'requisitions'
  | 'deliveries'
  | 'routes'
  | 'alerts'
  | 'analytics'
  | 'audit';

type NavKey = NavKeySource;

const NAV_BY_SURFACE: Record<Surface, readonly NavKey[]> = {
  admin: [
    'dashboard',
    'inventory',
    'catalogue',
    'batches',
    'stocktake',
    'requisitions',
    'deliveries',
    'alerts',
    'analytics',
    'audit',
  ],
  pharmacy: ['dashboard', 'catalogue', 'requisitions', 'inventory'],
  distributor: ['dashboard', 'routes'],
  // A driver gets exactly one destination. Not a reduced nav: the run in their
  // hand is the surface, and every other link would be somewhere they must not go.
  // Offering a driver "Inventory" teaches them this is a warehouse tool they
  // happen to be logged into.
  driver: ['deliveries'],
};

/**
 * Where each live destination actually is, per surface, relative to the surface
 * root. Everything absent here is rendered as not yet built.
 *
 * One table rather than a NOT_YET_BUILT list plus an href list. Keeping them
 * separate meant a key could be live on one surface and missing on another
 * without either list looking wrong -- 'inventory' is in the pharmacy nav too,
 * so a single global href map pointed it at /pharmacy/inventory/stocktake, which
 * does not exist. A 404 nav link is the specific failure this file's own header
 * comment warns about, introduced by the fix for another 404.
 *
 * The rule is therefore one sentence: if a surface has no path for a key, that
 * key is not built there.
 */
const HREF_BY_SURFACE: Partial<Record<Surface, Partial<Record<NavKey, string>>>> = {
  admin: {
    // An empty suffix means the surface root, which is the dashboard.
    dashboard: '',
    // The section root. Separate keys rather than one "inventory" pointing at
    // whichever page was built last: the section root and its pages are
    // different destinations and only one of them can be "the" inventory link.
    //
    // Every path in this table is locale-less on purpose. next-intl's Link adds
    // the active locale itself, and a `/${locale}` prefix here produces
    // /en/en/inventory. See the note in the active-state logic below.
    inventory: '/inventory',
    catalogue: '/inventory/products',
    batches: '/inventory/batches',
    stocktake: '/inventory/stocktake',
    requisitions: '/inventory/requisitions',
    // Built and deployed in M4 (#27), and never added to this table -- so the
    // navigation announced a shipped feature as planned-and-absent on every page.
    deliveries: '/deliveries',
    // M5. Same lesson as deliveries: shipped means the navigation says so, and a
    // feature that exists but reads as "planned" on every page is worse than absent.
    alerts: '/alerts',
    analytics: '/analytics',
  },
  pharmacy: { dashboard: '', catalogue: '/inventory/products' },
  distributor: { dashboard: '' },
};

/**
 * Destinations an ANALYST cannot use.
 *
 * ANALYST is the read-only role: they get the dashboards and reports and
 * nothing else. Hiding the operational surfaces matters more than it looks. A
 * visible link that leads to a screen where every action returns 403 teaches the
 * operator that the software is broken, and it advertises workflow that the role
 * is not permitted to perform.
 */
// `alerts` is in here because acknowledging an alert is a write, and a read-only role
  // clicking a button that always returns 403 learns that the software is broken. The
  // page itself renders read-only for them -- they can still see what is wrong.
  // `analytics` is deliberately absent: it is a pure read with no button on it, so an
  // analyst can do the whole job from it. That is the role's reason to exist.
  const READ_ONLY_HIDDEN = new Set<NavKey>([
    'requisitions',
    'deliveries',
    'routes',
    'alerts',
  ]);

export function AppNav({
  surface,
  role,
}: {
  surface: Surface;
  role: AppRole;
}) {
  const t = useTranslations('nav');
  const pathname = usePathname();

  const items = NAV_BY_SURFACE[surface].filter((item) =>
    role === 'ANALYST' ? !READ_ONLY_HIDDEN.has(item) : true,
  );

  return (
    /*
     * The nav scrolls rather than overflowing.
     *
     * min-w-0 lets this element shrink, but its children are whitespace-nowrap,
     * so with enough destinations the *content* overflows the box instead of the
     * box growing. That is the worst of both: the bounding boxes do not
     * intersect, so a box-based overlap test passes, and the last item is
     * painted on top of the controls -- where it silently swallowed clicks on
     * the language switcher. A navigation item that eats clicks on the language
     * switcher is invisible in a screenshot and obvious the first time somebody
     * tries to switch language.
     *
     * overflow-x-auto contains the overflow, and shrink-0 on the items keeps
     * each label whole rather than letting the last one clip mid-word.
     *
     * The trailing fade in .pf-nav-scroll is what says there is more. It was
     * removed once because it faded three destinations out of reach -- but that was
     * when the nav did NOT scroll from lg up, so the mask permanently covered
     * what was behind it. Now the strip scrolls at every width, so a destination
     * under the fade moves out from under it when the strip is scrolled. The mask
     * and the scroll have to agree, and now they do.
     */
    <nav
      aria-label={t('dashboard')}
      // A scrolling strip at every width, never a wrapping one.
      //
      // It used to wrap from lg up, and that was measured to be wrong at every
      // desktop size: the header is capped at max-w-7xl, so the navigation never
      // gets more than 742px however wide the window is, and the ten destinations
      // need about 890. It wrapped at 1024, 1280, 1440 and 1920 alike -- and the
      // header row is h-16, a fixed 64px, so the second row of items did not fit
      // inside it. "Analytics" and "Audit log" rendered below the header's glass
      // panel, on the page background, detached from the navigation they belong to.
      className="pf-nav-scroll"
      >
      {items.map((item) => {
        const surfaceRoot = `/${surface === 'admin' ? 'admin' : surface}`;
        const table = HREF_BY_SURFACE[surface];
        // Key PRESENCE decides liveness, not whether the suffix is truthy: the
        // dashboard is live and its suffix is ''. Testing the value instead made
        // every surface render no links at all, which the nav test caught.
          const isPending = !table || !(item in table);
          const suffix = isPending ? null : (table[item] ?? '');
          const href = isPending ? null : `${surfaceRoot}${suffix}`;

          // Active state, and this took three attempts to get right.
          //
          // A plain `pathname.startsWith(href)` looks like the obvious way to
          // keep a section lit while you move around inside it. It is wrong for
          // the surface root: the dashboard's href is `/admin`, and
          // `/admin/inventory/stocktake` starts with `/admin`, so clicking
          // Inventory lit up Dashboard AND Inventory at once. A prefix match can
          // only be right for a link that is *below* the root.
          //
          // So: the root matches exactly, and everything else matches on a
          // segment boundary. The trailing slash in the comparison is what stops
          // `/admin/inventory` from lighting up for a future
          // `/admin/inventory-archive` -- segment equality, not string equality.
          //
          // `pathname` is locale-less here, because this is next-intl's
          // usePathname rather than the platform's.
          //
          // Both `pathname` and the hrefs are locale-less for the same reason: this
          // is next-intl's Link and usePathname, and both sides of the comparison
          // have to agree on whether the locale is present. Prefixing only the href
          // is what produced /en/en/inventory on the logo link.
          const isActive =
            href !== null &&
            (suffix === ''
              ? pathname === href
              : pathname === href || pathname.startsWith(`${href}/`));

        if (href === null) {
          return (
            <span
              key={item}
              aria-disabled="true"
              title="Planned for a later milestone"
              className="cursor-not-allowed rounded-md px-3 py-2 text-sm whitespace-nowrap text-[color:var(--text-muted)] opacity-50"
            >
              {t(item)}
            </span>
          );
        }

        return (
          <Link
            key={item}
            href={href}
            // Prefetching off, and this is a measured decision rather than a habit.
            //
            // Next prefetches every link in the viewport by default, so the nine
            // navigation items fired nine RSC requests on every page load -- one
            // Supabase round trip each, for pages nobody had asked for. The dashboard
            // was issuing 46 requests where the driver surface issued 15, and the
            // difference was almost entirely speculation.
            //
            // Nothing is lost by turning it off here: these are server-rendered routes
            // answering in ~78ms, so a click is already fast, and each one costs a real
            // query set the tenant pays for in latency. A marketing site's navigation
            // is worth prefetching; a warehouse supervisor's is not.
            prefetch={false}
            aria-current={isActive ? 'page' : undefined}
            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-[var(--color-brand-600)] text-white'
                : 'hover:bg-[color:var(--text-muted)]/10'
            }`}
          >
            {t(item)}
          </Link>
        );
      })}
    </nav>
  );
}
