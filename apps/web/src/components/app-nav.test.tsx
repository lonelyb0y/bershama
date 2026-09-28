// @vitest-environment jsdom

// Navigation, which decides what a user can reach and what they are shown.
//
// The tests here are about a specific bug this file shipped once, twice in the
// same commit. A key can appear in MORE THAN ONE surface's nav list -- 'inventory'
// is in both admin and pharmacy -- so a single global map of live destinations
// pointed the pharmacy link at /pharmacy/inventory/stocktake, which does not
// exist. The 404 was introduced by the fix for another 404.
//
// Nothing about that shows up in a typecheck. A path is a string, and every
// string in it is valid. It only shows when a user clicks, which is why it is
// worth asserting structurally here.

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import en from '@/i18n/messages/en.json';

// @/i18n/routing wraps next-intl's createNavigation, which imports
// `next/navigation` -- a module that only resolves inside the Next.js build. The
// component under test is the href table and the pending logic, not next-intl's
// Link, so the routing layer is replaced with a plain anchor and a fixed
// pathname. Without this the suite cannot even load: "Cannot find module
// 'next/navigation'" is the whole failure.
vi.mock('@/i18n/routing', () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => '/admin',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { AppNav } = await import('./app-nav');

function mount(surface: 'admin' | 'pharmacy' | 'distributor', role: Parameters<typeof AppNav>[0]['role']) {
  // next-intl's usePathname comes from @/i18n/routing, which needs the Next.js
  // router context. A real router is not worth standing up for a nav test, so
  // pathname is asserted as "not active" everywhere, and the hrefs -- which is
  // what this file is actually about -- are read from the DOM.
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AppNav surface={surface} role={role} />
    </NextIntlClientProvider>,
  );
}

describe('live destinations', () => {
  it('points admin inventory at the stocktake screen', () => {
    mount('admin', 'WAREHOUSE_MANAGER');

    const link = screen.getByRole('link', { name: 'Inventory' });
    // Relative, because next-intl's Link prepends the locale. Asserting the
    // suffix keeps this test readable and survives a routing prefix change.
    expect(link.getAttribute('href')).toContain('/admin/inventory/stocktake');
  });

  it('does not give pharmacy a link to a page that does not exist', () => {
    mount('pharmacy', 'PHARMACY_MANAGER');

    // The bug. 'inventory' is in the pharmacy nav list, so a global href map
    // produced a real-looking link to /pharmacy/inventory/stocktake, which 404s.
    const link = screen.queryByRole('link', { name: 'Inventory' });
    expect(link).toBeNull();
  });

  it('renders a destination with no page as disabled, not as a link', () => {
    mount('pharmacy', 'PHARMACY_MANAGER');

    // A disabled span rather than a link, so it cannot be activated. The
    // alternative -- a link that 404s -- teaches the operator the software is
    // unreliable, which is what the header comment warns about.
    const item = screen.getByText('Inventory');
    expect(item.tagName).not.toBe('A');
    expect(item.closest('span')).toHaveAttribute('aria-disabled', 'true');
  });

  it('renders a dashboard link on every surface', () => {
    // The assertion that stops the loop below from passing vacuously. Removing
    // the dashboard's table entry made every surface render NO links at all, and
    // a for-loop over getAllByRole('link') simply never executed -- so the test
    // that was supposed to catch it reported success. A guard on the loop
    // invariant is the fix; "the loop ran" is not the same as "there was
    // something to look at".
    for (const surface of ['admin', 'pharmacy', 'distributor'] as const) {
      const { unmount } = mount(surface, 'TENANT_ADMIN');

      expect(
        screen.getByRole('link', { name: 'Dashboard' }),
        `${surface} should reach its dashboard`,
      ).toBeInTheDocument();

      unmount();
    }
  });

  it('never labels a link with something other than where it goes', () => {
    // The dashboard legitimately points at the surface root. Anything ELSE
    // pointing there would take the user to the dashboard while labelled
    // "Inventory" -- which is what a missing suffix produces, and the version of
    // this test that forbade the root outright also forbade the one link that is
    // supposed to be there.
    for (const surface of ['admin', 'pharmacy', 'distributor'] as const) {
      const { unmount } = mount(surface, 'TENANT_ADMIN');

      for (const link of screen.getAllByRole('link')) {
        const href = link.getAttribute('href');
        const label = link.textContent?.trim();

        expect(href, `${surface}: ${label}`).toBeTruthy();
        if (href === `/${surface}`) {
          expect(label, `${surface}: ${label} points at the surface root`).toBe('Dashboard');
        }
      }
      unmount();
    }
  });
});

describe('the read-only role', () => {
  it('hides the operational surfaces from an ANALYST', () => {
    mount('admin', 'ANALYST');

    expect(screen.queryByText('Requisitions')).toBeNull();
    expect(screen.queryByText('Deliveries')).toBeNull();
    // A visible link to a screen where every action returns 403 teaches the
    // operator the software is broken, and advertises workflow the role cannot
    // perform.
  });

  it('still shows an ANALYST the inventory screen', () => {
    // Stocktake is readable; the WRITE is refused in the database by
    // private.require_inventory_write(). Hiding the screen would hide a fact the
    // analyst is entitled to know.
    mount('admin', 'ANALYST');
    expect(screen.getByRole('link', { name: 'Inventory' })).toBeInTheDocument();
  });
});
