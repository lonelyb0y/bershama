'use client';

import * as React from 'react';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

/**
 * Analytics, after the page.
 *
 * ── why they are not in the root layout ──────────────────────────────────────
 *
 * Both of these inject their script by creating a `<script>` element, and both
 * did it while the layout was still hydrating -- which is the critical path. Two
 * third-party scripts, on every page, including the one whose LCP element a
 * person is waiting for.
 *
 * They are deferred to the window `load` event, which is after the page has
 * painted and the LCP element is on screen. The numbers they collect are
 * unchanged: the field data is about the load, not about the first byte, and a
 * script that arrives after the page is up reports the same page.
 *
 * The scripts are first-party -- they report to the deployment the request
 * already came from, so no analytics vendor sees a doctor's or a driver's IP
 * address. That reasoning is unchanged; only the timing moved.
 *
 * ── why useSyncExternalStore and not a state flag ───────────────────────────
 *
 * The window's loaded-ness is not React state -- it is a fact about the
 * document that the browser already knows how to tell us about, and it changes
 * exactly once. A subscription to it is what `useSyncExternalStore` is for, and
 * it does the work without a `setState` inside an effect, which React 19's
 * lint rightly refuses: an effect that sets state on mount is a render pass
 * the component did not need, and it is how a component ends up rendering twice
 * on every page.
 */
function subscribe(onStoreChange: () => void) {
  if (document.readyState === 'complete') {
    // Already loaded -- there will be no event, so the subscription is a no-op
    // and the snapshot below is what tells the component.
    return () => {};
  }

  window.addEventListener('load', onStoreChange, { once: true });
  return () => window.removeEventListener('load', onStoreChange);
}

function getSnapshot() {
  return document.readyState === 'complete';
}

/** The server has no window, and the page has certainly not loaded. */
function getServerSnapshot() {
  return false;
}

export function DeferredAnalytics() {
  const loaded = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (!loaded) return null;

  return (
    <>
      <Analytics mode="auto" />
      <SpeedInsights />
    </>
  );
}
