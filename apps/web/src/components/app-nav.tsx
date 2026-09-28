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

const NAV_BY_SURFACE = {
  admin: ['dashboard', 'inventory', 'batches', 'requisitions', 'deliveries', 'alerts', 'analytics', 'audit'],
  pharmacy: ['dashboard', 'catalogue', 'requisitions', 'inventory'],
  distributor: ['dashboard', 'routes'],
} as const;

type NavKey = (typeof NAV_BY_SURFACE)[keyof typeof NAV_BY_SURFACE][number];

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
    inventory: '/inventory/stocktake',
  },
  pharmacy: { dashboard: '' },
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
const READ_ONLY_HIDDEN = new Set<NavKey>(['requisitions', 'deliveries', 'routes']);

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
    <nav aria-label={t('dashboard')} className="hidden items-center gap-1 md:flex">
      {items.map((item) => {
        const surfaceRoot = `/${surface === 'admin' ? 'admin' : surface}`;
        const table = HREF_BY_SURFACE[surface];
        // Key PRESENCE decides liveness, not whether the suffix is truthy: the
        // dashboard is live and its suffix is ''. Testing the value instead made
        // every surface render no links at all, which the nav test caught.
        const isPending = !table || !(item in table);
        const href = isPending ? null : `${surfaceRoot}${table[item] ?? ''}`;
        // Prefix match, so /admin/inventory/stocktake keeps "Inventory" active
        // while the query string changes between locations.
        const isActive = href !== null && pathname.startsWith(href);

        if (href === null) {
          return (
            <span
              key={item}
              aria-disabled="true"
              title="Planned for a later milestone"
              className="cursor-not-allowed rounded-md px-2.5 py-1.5 text-sm text-[color:var(--text-muted)] opacity-50"
            >
              {t(item)}
            </span>
          );
        }

        return (
          <Link
            key={item}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
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
