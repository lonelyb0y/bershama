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
 * ── why the system preference still needs no JavaScript ──────────────────────
 *
 * globals.css honours prefers-color-scheme on its own, through a media query
 * scoped to :root:not(.light):not(.dark). So with no stored preference and no
 * JavaScript at all, the right theme still applies -- correctly, with no flash,
 * and it keeps working if this component never runs.
 *
 * This component's only job is the part CSS cannot do: override the OS when the
 * user has explicitly chosen. Absence of a stored preference is the system
 * state, deliberately, so there is one fewer key to keep in sync.
 */
export function ThemeInit() {
  useLayoutEffect(() => {
    const root = document.documentElement;

    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(KEY);
    } catch {
      // Private browsing in some browsers throws on access. A theme is a
      // preference, not a requirement, so the CSS media query carries on.
      return;
    }

    // Bershama is dark-first.
    //
    // The absence of a stored preference used to mean "follow the OS", which meant a
    // visitor whose laptop was set to light saw a white page -- the one thing this
    // design is not. The default is now the product's own theme, and the toggle is
    // how you leave it.
    const dark = stored !== 'light';
    root.classList.toggle('dark', dark);
    root.classList.toggle('light', !dark);
  }, []);

  // Renders nothing. The work is a side effect before paint, not markup.
  return null;
}

const KEY = 'bershama:theme';
