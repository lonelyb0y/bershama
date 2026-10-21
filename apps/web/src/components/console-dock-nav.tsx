'use client';

import * as React from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';

import { Dock, DockIcon, DockItem, DockLabel } from '@/components/console-dock';
import {
  IconChartBar,
  IconClipboardCheck,
  IconCube,
  IconLayers,
  IconTruck,
} from '@/components/icons/regen';

/**
 * The console dock's contents.
 *
 * ── why the destinations are hard-coded here and not read from the nav ────────
 *
 * The nav table is per-surface and per-role, and it is rendered server-side. The
 * dock is a client component, because the magnification follows a pointer.
 *
 * So the destinations are repeated here, and they are the ADMIN surface's
 * six. The duplication is deliberate and it is a small one: the dock is a
 * different affordance for the same destinations, not a second navigation
 * system, and it appears on exactly one surface.
 *
 * A reader who follows a dock icon to a page that does not exist is a broken
 * product, so every one of these is a path that exists.
 */
const ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: IconLayers },
  { href: '/admin/inventory', label: 'Inventory', icon: IconCube },
  { href: '/admin/inventory/batches', label: 'Batches', icon: IconClipboardCheck },
  { href: '/admin/inventory/requisitions', label: 'Orders', icon: IconLayers },
  { href: '/admin/deliveries', label: 'Deliveries', icon: IconTruck },
  { href: '/admin/analytics', label: 'Analytics', icon: IconChartBar },
] as const;

export function ConsoleDockNav({ locale }: { locale: string }) {
  const pathname = usePathname();

  // The dock is a MOUSE affordance. On a touch screen the magnification does
  // nothing, so the dock is not rendered at all rather than rendered as a row
  // of small targets.
  const [pointer, setPointer] = React.useState(false);

  React.useEffect(() => {
    const query = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setPointer(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  if (!pointer) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 hidden lg:block">
      <div className="pointer-events-auto">
        <Dock>
          {ITEMS.map((item) => {
            // The path is built at runtime from the locale and a constant, so
            // Next's typed routes cannot see that it is one of the real ones.
            // The cast is the documented escape hatch, and the six paths it
            // covers are all real pages -- a dock link to a 404 is the specific
            // failure the nav table's own comment warns about.
            const href = `/${locale}${item.href}` as Route;
            const active = pathname === href;
            const Icon = item.icon;

            return (
              <DockItem key={item.href} className="aspect-square rounded-full">
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className="grid size-full place-items-center rounded-full"
                >
                  <DockLabel>{item.label}</DockLabel>
                  <DockIcon>
                    <Icon
                      className={
                        active
                          ? 'text-[var(--primary)] size-full'
                          : 'text-[var(--text-muted)] size-full'
                      }
                    />
                  </DockIcon>
                </Link>
              </DockItem>
            );
          })}
        </Dock>
      </div>
    </div>
  );
}
