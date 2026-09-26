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
 * Destinations that exist in navigation but whose pages land in a later
 * milestone. Rendered as disabled rather than hidden, so the shape of the
 * product is visible while it is being built.
 */
const NOT_YET_BUILT = new Set<NavKey>([
  'batches',
  'deliveries',
  'analytics',
  'audit',
  'inventory',
  'alerts',
  'routes',
  'catalogue',
]);

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
        const href = `/${surface === 'admin' ? 'admin' : surface}`;
        const isActive = pathname === href;
        const isPending = NOT_YET_BUILT.has(item);

        if (isPending) {
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
