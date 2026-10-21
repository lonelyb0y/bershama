'use client';

import * as React from 'react';

/**
 * The animated home background.
 *
 * ── what it is ────────────────────────────────────────────────────────────────
 *
 * Vanta.js -- a three.js field of points that drifts and responds to the
 * pointer -- behind the landing page's hero, in the accent colour, barely
 * visible. It is the one animated thing in the product: every other surface is
 * a working console, and a working console does not drift.
 *
 * ── the four conditions, and why each one is load-bearing ────────────────────
 *
 * 1. **It is never on the server.** `next/dynamic` with `ssr: false`, so the
 *    markup is empty and the page does not wait for a canvas.
 *
 * 2. **It never loads before the page has painted.** `requestIdleCallback`,
 *    after the LCP element is on screen. A background that arrives first is a
 *    background that delays the thing a person came for, and three.js is not a
 *    small thing to arrive first.
 *
 * 3. **It never loads at all when the reader has asked for reduced motion, or
 *    when the device has no WebGL.** The background is decoration, and
 *    decoration that cannot be rendered is not a degraded page -- it is the same
 *    page. A machine without WebGL gets the parchment, which is the design.
 *
 * 4. **It cannot take the page down.** A failure inside three.js -- an old
 *    driver, a shader the machine cannot compile -- is caught, and the canvas is
 *    removed. The hero is still there.
 *
 * ── the cost, stated plainly ──────────────────────────────────────────────────
 *
 * three.js is around 120 KiB gzipped. This ADDS weight to the page, on the one
 * route where the LCP element matters most. It is deferred past the LCP paint
 * and route-split so it cannot affect LCP, and the before/after report says so
 * rather than hiding it. A person on a metered connection is better served by
 * the page without it, which is why the mobile route can drop it.
 */
export function HomeBackground() {
  const host = React.useRef<HTMLDivElement>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    const element = host.current;
    if (!element) return;

    // ── condition 3a: reduced motion ──────────────────────────────────────
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // ── condition 3b: no WebGL ─────────────────────────────────────────────
    let webgl: WebGLRenderingContext | null = null;
    try {
      webgl = document.createElement('canvas').getContext('webgl');
    } catch {
      webgl = null;
    }
    if (!webgl) return;

    // Set when the effect is torn down, so an in-flight import can notice that
    // the component is gone before it initialises a canvas into a dead element.
    const state = { cancelled: false };
    let cleanup: (() => void) | undefined;

    // ── condition 2: after the page has painted ────────────────────────────
    const start = () => {
      if (state.cancelled) return;
      void (async () => {
        try {
          // The MODULE NAMESPACE, not its default export.
          //
          // three's ESM build has no default export -- every symbol is a named
          // export -- so `import('three').default` is `undefined`. Assigning that
          // to the global is what produced "Cannot read properties of undefined
          // (reading 'PerspectiveCamera')" on the first run.
          const THREE = await import('three');
          // Vanta was written against a three.js that predates the current
          // major, and it looks for a global. So it gets one.
          (globalThis as unknown as { THREE?: unknown }).THREE = THREE;

          const { default: DOTS } = await import('vanta/dist/vanta.dots.min');

          const instance = DOTS({
            el: element,
            color: 0x43b189,
            backgroundColor: 0x141613,
            backgroundAlpha: 0,
            mouseSensitivity: 1.4,
            scale: 1.6,
            speed: 0.35,
          });

          cleanup = () => {
            try {
              instance?.destroy?.();
            } catch {
              // The effect is going away; failing to tear it down cleanly
              // must not throw on the way out.
            }
          };

          if (state.cancelled) {
            cleanup();
            return;
          }
          setReady(true);
        } catch {
          // ── condition 4: it cannot take the page down ────────────────────
          // A shader the machine cannot compile, an old driver, a missing
          // global. The canvas goes away and the page carries on.
          element.remove();
        }
      })();
    };

    // The idle callback, if this browser has one. The `in` check narrows
    // `window` to `never` in the other branch, so the feature is read off the
    // object rather than tested on it.
    const idle = (
      window as Window & {
        requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
        cancelIdleCallback?: (handle: number) => void;
      }
    ).requestIdleCallback;

    if (typeof idle === 'function') {
      const handle = idle(start, { timeout: 2500 });
      return () => {
        state.cancelled = true;
        window.cancelIdleCallback?.(handle);
        cleanup?.();
      };
    }

    const timer = setTimeout(start, 1200);
    return () => {
      state.cancelled = true;
      clearTimeout(timer);
      cleanup?.();
    };
  }, []);

  return (
    <div
      ref={host}
      aria-hidden="true"
      data-testid="home-background"
      data-ready={ready ? 'true' : 'false'}
      className="pointer-events-none fixed inset-0 -z-10 opacity-45"
    />
  );
}
