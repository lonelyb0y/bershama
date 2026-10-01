'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

import { BackdropFallback } from './glass';
import { canUseWebGL, prefersReducedMotion } from './liquid-backdrop';

/**
 * Decides whether the live backdrop gets mounted at all.
 *
 * ── why this exists rather than a conditional inside the canvas ─────────────
 * Three things have to be true before a fragment shader is worth creating: the
 * component must be on the client, WebGL must exist, and motion must be wanted.
 * All three can only be established in the browser, so this component renders
 * nothing on the server and settles on one of two answers on the client.
 *
 * ── why the canvas is dynamically imported ─────────────────────────────────
 * Not to protect a phone from a megabyte any more: the backdrop is raw WebGL now,
 * and the three.js version that needed 899KB has gone. This is so a GL context is
 * never initialised during hydration -- the CSS gradient is on screen immediately
 * and the canvas arrives a tick later. So the page is never blank, and never
 * blocking on a capability it might not have.
 *
 * ── why the fallback is not a lesser version of the page ────────────────────
 * It is the same page. The panels, the figures and the interactions are HTML and CSS;
 * only the animated field behind them is conditional. Somebody on a machine with no
 * WebGL gets the dashboard, not a message about WebGL.
 */

// Still dynamically imported, and the reason has changed: the module is now a few
// hundred bytes of WebGL rather than 899KB of 3D engine, so this is no longer about
// protecting a phone from a megabyte. It is about not running a GL context
// initialisation during hydration at all -- the fallback gradient is on screen
// immediately and the canvas arrives after.
const LiquidBackdropScene = dynamic(
  () => import('./liquid-backdrop').then((module) => module.LiquidBackdrop),
  { ssr: false },
);

type Decision = 'pending' | 'live' | 'static';

export function DashboardBackdrop() {
  const [decision, setDecision] = useState<Decision>('pending');
  const [dark, setDark] = useState(false);

  useEffect(() => {
    // The theme class is on <html> and is set before paint by an inline script, so
    // reading it here is correct rather than a guess -- but it can change later, so
    // the class is watched.
    const root = document.documentElement;

    const applyTheme = () => setDark(root.classList.contains('dark'));
    applyTheme();

    const observer = new MutationObserver(applyTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });

    // Deferred out of the effect body: setting state synchronously inside an effect is
    // a cascading render, and neither of these two answers is needed within the same
    // frame as the mount.
    const decide = setTimeout(() => {
      setDecision(canUseWebGL() && !prefersReducedMotion() ? 'live' : 'static');
    }, 0);

    return () => {
      clearTimeout(decide);
      observer.disconnect();
    };

  }, []);

  // Rendered while the decision is still open, and whenever it lands on 'static'.
  // Both are the same gradient, so there is no flash of a different background when
  // the answer arrives.
  if (decision !== 'live') {
    return <BackdropFallback dark={dark} />;
  }

  return <LiquidBackdropScene dark={dark} />;
}