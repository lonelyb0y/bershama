'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@/components/ui/button';
import { MenuToggleIcon } from '@/components/ui/menu-toggle-icon';
import { Logo } from '@/components/logo';
import {
  IconChartBar,
  IconClipboardCheck,
  IconCube,
  IconLayers,
  IconRoute,
  IconShieldCheck,
  IconTruck,
  IconUsers,
} from '@/components/icons/regen';

/**
 * The public header.
 *
 * ── what this is ──────────────────────────────────────────────────────────────
 *
 * Two dropdown groups, a sign-in, a create button, and a mobile sheet. The
 * STRUCTURE came from a reference header; the CONTENT is Bershama's, and that
 * is the part that matters. A header that says "Product / Company / Pricing" on
 * a pharmaceutical supply chain is a header for a different product.
 *
 * ── the destinations ──────────────────────────────────────────────────────────
 *
 * Platform: the things a distributor actually does. Inventory, Batches,
 * Requisitions, Deliveries, Analytics.
 *
 * For whom: the two audiences. A distributor reads the expiry and the stock; a
 * pharmacy reads the order and the delivery. Two links each beats five.
 *
 * ── why the dropdowns are CSS and not a component ─────────────────────────────
 *
 * The house style in `components/ui/` is a hand-curated set, and the only
 * primitive the repository actually has is a Base UI menu -- which opens on a
 * click. A navigation dropdown opens on a HOVER, and a click-opens menu in a
 * header reads as a bug: you move the pointer towards it and the thing you are
 * aiming at moves away.
 *
 * So the panels are CSS: `group-hover` and `focus-within`. The keyboard path
 * works because the panel's links are real links in the DOM, in order, after the
 * trigger -- so Tab moves into the panel and `focus-within` opens it.
 *
 * ── the mobile sheet is a PORTAL ──────────────────────────────────────────────
 *
 * A fixed panel inside a `sticky` header is inside the header's stacking
 * context, and on a phone with a keyboard open the header is the thing that
 * scrolls away -- so the sheet would scroll away with it, mid-typing.
 *
 * Rendering it through a portal puts it in the body's context, where `fixed`
 * means the viewport, and the header cannot take it with it.
 */
type LinkItem = {
  title: string;
  href: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
};

const PLATFORM: LinkItem[] = [
  {
    title: 'Inventory',
    href: '#capabilities',
    description: 'Catalogue, stock levels and locations',
    icon: IconCube,
  },
  {
    title: 'Batches & expiry',
    href: '#capabilities',
    description: 'Every lot, and the day it turns',
    icon: IconClipboardCheck,
  },
  {
    title: 'Requisitions',
    href: '#capabilities',
    description: 'Orders, filled FEFO',
    icon: IconLayers,
  },
  {
    title: 'Deliveries',
    href: '#capabilities',
    description: 'Runs, vans and proof of delivery',
    icon: IconTruck,
  },
  {
    title: 'Analytics',
    href: '#capabilities',
    description: 'Stock value and expiry exposure',
    icon: IconChartBar,
  },
];

const FOR_WHOM: LinkItem[] = [
  {
    title: 'For distributors',
    href: '#roles',
    description: 'Warehouses, lots, expiry and the cold chain',
    icon: IconShieldCheck,
  },
  {
    title: 'For pharmacies',
    href: '#roles',
    description: 'Order stock and watch it arrive',
    icon: IconUsers,
  },
  {
    title: 'Compliance',
    href: '#capabilities',
    description: 'WHO GDP-aligned batch traceability',
    icon: IconClipboardCheck,
  },
  {
    title: 'Network',
    href: '#capabilities',
    description: 'The Cairo and Giza hub, and the delta routes',
    icon: IconRoute,
  },
];

export function MarketingHeader() {
  const [open, setOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  React.useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <header
      className={`sticky top-0 z-50 w-full border-b border-transparent transition-colors ${
        scrolled
          ? 'bg-[var(--surface)]/92 border-[var(--border)] backdrop-blur-lg'
          : ''
      }`}
    >
      <nav className="mx-auto flex h-16 w-full max-w-[1400px] items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <a
            href="#top"
            className="rounded-lg p-1 hover:bg-[color:var(--text-muted)]/10"
            aria-label="Bershama"
          >
            <Logo />
          </a>

          <ul className="hidden items-center gap-1 md:flex">
            <Dropdown label="Platform" items={PLATFORM} />
            <Dropdown label="For whom" items={FOR_WHOM} />
          </ul>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <Button variant="ghost" nativeButton={false} render={<a href="#signin" />}>
            Sign in
          </Button>
          <Button nativeButton={false} render={<a href="#create" />}>Create your organisation</Button>
        </div>

        <Button
          size="icon"
          variant="ghost"
          onClick={() => setOpen((v) => !v)}
          className="md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
        >
          <MenuToggleIcon open={open} className="size-5" />
        </Button>
      </nav>

      <MobileMenu open={open} className="flex flex-col justify-between gap-4 overflow-y-auto">
        <div className="flex w-full flex-col gap-4">
          <span className="pf-mono text-[11px] tracking-[0.08em] text-[var(--text-muted)] uppercase">
            Platform
          </span>
          {PLATFORM.map((link) => (
            <ListItem key={link.title} {...link} />
          ))}
          <span className="pf-mono text-[11px] tracking-[0.08em] text-[var(--text-muted)] uppercase">
            For whom
          </span>
          {FOR_WHOM.map((link) => (
            <ListItem key={link.title} {...link} />
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <Button variant="outline" nativeButton={false} render={<a href="#signin" />}>
            Sign in
          </Button>
          <Button nativeButton={false} render={<a href="#create" />}>Create your organisation</Button>
        </div>
      </MobileMenu>
    </header>
  );
}

/**
 * A dropdown group.
 *
 * The panel is in the DOM after the trigger, so Tab moves into it, and
 * `focus-within` keeps it open while the focus is in there.
 */
function Dropdown({ label, items }: { label: string; items: LinkItem[] }) {
  return (
    <li className="group relative">
      <button
        type="button"
        className="hover:bg-[color:var(--text-muted)]/10 focus-visible:ring-ring/50 inline-flex h-9 items-center gap-1 rounded-lg px-3 text-sm font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text)] focus-visible:ring-3 focus-visible:outline-none"
      >
        {label}
        <svg
          viewBox="0 0 24 24"
          className="size-3 transition-transform group-hover:rotate-180 group-focus-within:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 9L12 15L18 9" />
        </svg>
      </button>

      <div
        className="invisible absolute start-0 top-full z-50 w-[34rem] opacity-0 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
        // The pointer is on the trigger, and the panel is 4px below it. Without
        // this, the pointer crosses the gap and the panel closes before it
        // arrives.
        style={{ paddingTop: '0.25rem' }}
      >
        <ul className="grid grid-cols-2 gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-2 shadow-lg">
          {items.map((item) => (
            <li key={item.title}>
              <ListItem {...item} />
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

type MobileMenuProps = React.ComponentProps<'div'> & {
  open: boolean;
};

function MobileMenu({ open, children, className, ...props }: MobileMenuProps) {
  // The portal is a client-only concern, and the sheet is never open on the
  // server, so this returns null there and the first client render agrees.
  if (!open || typeof window === 'undefined') return null;

  return createPortal(
    <div
      id="mobile-menu"
      className={`bg-[var(--surface)]/95 supports-[backdrop-filter]:bg-[var(--surface)]/70 fixed inset-x-0 top-16 bottom-0 z-40 flex flex-col overflow-hidden border-t border-[var(--border)] backdrop-blur-lg md:hidden ${className ?? ''}`}
    >
      <div
        data-slot="open"
        className="data-[slot=open]:animate-in data-[slot=open]:zoom-in-97 ease-out size-full p-4"
        {...props}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

function ListItem({ title, description, icon: Icon, href }: LinkItem) {
  return (
    <a
      href={href}
      className="hover:bg-[color:var(--text-muted)]/10 focus:bg-[color:var(--text-muted)]/10 flex items-center gap-3 rounded-xl p-2"
    >
      <span className="bg-[var(--surface-2)] flex aspect-square size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)]">
        <Icon className="text-[var(--primary)] size-4" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium">{title}</span>
        {description ? (
          <span className="truncate text-xs text-[var(--text-muted)]">{description}</span>
        ) : null}
      </span>
    </a>
  );
}
