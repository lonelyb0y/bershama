'use client';

import { useLayoutEffect } from 'react';

/**
 * Applies the saved theme before the browser paints.
 *
 * ── why this is not an inline <script> ───────────────────────────────────────
 *
 * It was one, and that was wrong twice over.
 *
 * The first version rendered `<script dangerouslySetInnerHTML>` in the layout's
 * <head>. React 19 throws on that -- "Encountered a <script> tag while rendering
 * React component. Scripts inside React components are never executed when
 * rendering on the client" -- and the failure was not cosmetic: the render
 * aborted, the class was never set, and a dark-mode user got a light page.
 * `<Script strategy="beforeInteractive">` from next/script throws the same
 * error, because it also renders a <script> element.
 *
 * useLayoutEffect is the right tool and there is no trade-off: React runs it
 * synchronously after the DOM is mutated and BEFORE the browser paints, so the
 * class is in place for the very first frame. An effect that only *reads* local
 * storage and writes one class name is exactly what it is for. The inline script
 * was solving a problem this hook solves natively.
 *
 * ── why the default theme needs no JavaScript ─────────────────────────────────
 *
 * Dark is the BASE in globals.css, not a variant of it. So the common case -- a
 * first-time visitor with no stored preference and, at the extreme, no JavaScript
 * at all -- is served by the stylesheet alone, in the initial HTML, with no
 * possible flash.
 *
 * That is a deliberate reversal. The palette used to be light in :root with dark
 * in .dark, which meant the no-preference case fell through to the operating
 * system's colour scheme, and a visitor whose laptop was set to light saw a white
 * page -- the one thing this design is not. The product's own theme is now the
 * ground, and the stylesheet says so.
 *
 * This component's only job is the part CSS cannot do: apply an explicit choice.
 */
export function ThemeInit() {
  useLayoutEffect(() => {
    const root = document.documentElement;

    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(KEY);
    } catch {
      // Private browsing in some browsers throws on access. A theme is a
      // preference, not a requirement, so the base stylesheet carries on.
      return;
    }

    // Nothing stored: leave the root unclassed. The base is the product's own
    // theme, and writing a class here would be writing the class that CSS
    // already implies.
    if (stored !== 'light' && stored !== 'dark') return;

    root.classList.toggle('light', stored === 'light');
    root.classList.toggle('dark', stored === 'dark');
  }, []);

  // Renders nothing. The work is a side effect before paint, not markup.
  return null;
}

const KEY = 'bershama:theme';
