'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker.
 *
 * ── why this is a component and not a script tag in the layout ──────────────
 *
 * Because registering a worker from the server-rendered HTML would mean every
 * visitor's browser gets one, including the ones on the admin surface where there
 * is nothing to gain. The driver surface is the only one that must survive losing
 * signal, so only the driver surface registers -- and mounting this component is
 * the whole opt-in.
 *
 * ── why the failure is silent ───────────────────────────────────────────────
 *
 * A service worker that fails to register is not a broken application: the queue
 * still works, because queued intents live in IndexedDB rather than in the worker.
 * The worker only keeps the code to draw the screen. So a registration failure is
 * logged and otherwise ignored -- surfacing it would make a non-fatal condition
 * look like an outage to whoever is trying to use a phone.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // Production only: a worker in front of a dev server caches the very bundles
    // that are being edited, which is a confusing afternoon rather than a useful one.
    if (process.env.NODE_ENV !== 'production') return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
        console.warn('[bershama] service worker registration failed', error);
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}