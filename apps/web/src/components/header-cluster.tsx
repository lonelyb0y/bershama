'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Link } from '@/i18n/routing';
import { ThemeToggle } from './theme-toggle';

/**
 * The right-hand cluster of the header: theme, language, and who you are.
 *
 * ── why the identity moved into a menu ───────────────────────────────────────
 * It used to be a name, a role and a "Sign out" button sitting loose in the header
 * next to eight navigation links. The comment above that markup records what that
 * cost: the row ran out of room, "Sign out" broke across two lines, and so did the
 * user's name. Two of the three things in that cluster are only needed occasionally
 * and all three are phrases that must not wrap.
 *
 * A menu is the honest answer. The two controls that are needed constantly -- theme
 * and language -- stay visible; the identity becomes a trigger showing an initial,
 * which is one glyph, and the name, role and sign-out live inside where there is
 * room for them to be phrases.
 *
 * ── the menu is right-aligned to its trigger ────────────────────────────────
 * It opens towards the end of the reading direction, so it never covers the
 * navigation. That is the "on the right or on the left" question answered by the
 * content rather than by a breakpoint: the identity lives at the end of the row in
 * both directions, because that is where the eye leaves.
 */
export function HeaderCluster({
  displayName,
  role,
  surface,
}: {
  displayName: string;
  role: string;
  surface: 'admin' | 'pharmacy' | 'distributor' | 'driver';
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  // A single letter, taken from whichever name is being shown. Two-letter initials
  // are better with two words and wrong with one, and "ML" for a person called
  // Mostafa reads as initials they were never given.
  const initial = displayName.trim().charAt(0).toUpperCase() || '·';

  return (
    // A stable handle for the overlap tests. This used to be found with
    // `header .ms-auto`, which a layout rewrite removed -- and a test that cannot
    // find its element fails as a timeout, not as "the selector is stale", so the
    // cost of that was thirty seconds per width and a message about a box.
    <div data-testid="header-cluster" className="flex shrink-0 items-center gap-2">
      <ThemeToggle />

      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          // The trigger carries the identity, so it needs a name that is not just
          // a letter: `aria-label` is what a screen reader announces, and without it
          // this is an unlabelled button in the top corner of every page.
          aria-label={`${displayName} — ${t('common.account')}`}
          data-testid="account-menu"
          className="group flex items-center gap-2 rounded-full border border-[color:var(--border)]/60 bg-[color:var(--surface-raised)]/70 py-1 ps-1 pe-3 text-start transition-colors hover:bg-[color:var(--surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-full bg-[color:var(--color-brand-600)] text-sm font-semibold text-white"
          >
            {initial}
          </span>
          {/* Hidden below sm: at that width the header has the navigation to fit
              and a name is the first thing to go, not the last. */}
          <span className="hidden min-w-0 leading-tight sm:block">
            <span className="block truncate text-sm font-medium">{displayName}</span>
            <span className="block truncate text-xs text-[color:var(--text-muted)]">
              {/* Translated, never a raw enum: "WAREHOUSE_MANAGER" means nothing to
                  a warehouse supervisor. */}
              {t(`roles.${role}` as never)}
            </span>
          </span>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-60" data-testid="account-menu-content">
          {/* The group wrapper is load-bearing, not decoration.
           *
           * shadcn's `DropdownMenuLabel` maps to Base UI's `Menu.GroupLabel`, which
           * throws `MenuGroupContext is missing` unless it is inside a `Menu.Group`.
           * Rendered bare, it did not render badly -- it *crashed the route*, and the
           * global error boundary replaced the whole page with "This page couldn't
           * load". So clicking the account menu in the top right of every
           * authenticated page threw away the session's UI, and sign-out, which only
           * lives in that menu, was unreachable.
           *
           * That is why `auth.spec.ts`'s sign-out test has been failing: it was not
           * asserting the wrong thing, it was reporting a crash. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel className="font-normal">
              <span className="block truncate text-sm font-medium">{displayName}</span>
              <span className="block truncate text-xs text-[color:var(--text-muted)]">
                {t(`roles.${role}` as never)}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/settings" />} className="cursor-pointer">
              {t('nav.settings')}
            </DropdownMenuItem>
          {/* Sign-out is a POST, so it is a form and not a link: a link would
              prefetch it, and it would not work with JavaScript disabled.

              The menu item *renders as* a real submit button rather than being a
              `div role="menuitem"` that reaches into the document and calls
              `requestSubmit()` on it.

              That indirection existed because Radix's `asChild` merges props onto its
              child, and a form's submit is not a click handler -- so the earlier
              version put the handler on the item and reached for the form by id. It
              worked, and it meant two things nobody reviewing it would guess: the
              control was announced as a menu item rather than a button, and sign-out
              functioned at all only with JavaScript running, inside a form that
              carried a `method` for precisely the case where it would not be.

              Base UI's `render` prop does the merging properly, so the item is a
              button that submits its own form natively -- announced as a button, and
              working with scripting off. */}
            <form action="/auth/sign-out" method="post" id="sign-out-form">
              <DropdownMenuItem render={<button type="submit" />} className="cursor-pointer">
                {t('common.signOut')}
              </DropdownMenuItem>
            </form>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Kept out of the DOM's tab order rather than hidden with CSS: a hidden
          element that still takes focus is the classic keyboard trap in a header. */}
      <span className="sr-only" data-surface={surface} />
    </div>
  );
}