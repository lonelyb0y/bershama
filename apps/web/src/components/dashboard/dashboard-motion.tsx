'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';

/**
 * The dashboard's motion layer.
 *
 * ── what this is for ────────────────────────────────────────────────────────
 * The references are full of scroll reveals, staggered entries and counting
 * numbers. Applied to an operations dashboard, that is a trap: an animated figure
 * is a figure whose value is still changing when somebody reads it, and a
 * warehouse supervisor glancing at stock during a shift should not have to wait for
 * a counter to finish.
 *
 * So the rules here are narrow and deliberate:
 *
 * 1. Numbers are never animated. They are rendered final on the server and only
 *    revealed. A counter that tweens to a value is decoration on top of a fact.
 * 2. Everything is one-shot and short. A tile fades up and stays up. No loop, no
 *    parallax on content, no scroll-jacking.
 * 3. `prefers-reduced-motion` gets the end state immediately -- which is why
 *    gsap.matchMedia is used rather than a media query on the CSS alone: the
 *    animation must not run for a single frame before it is skipped.
 *
 * GSAP is here because it is the engine the AnimateMaster-style references are
 * built on, and because `matchMedia` handles the reduced-motion branch in one place
 * rather than in every component.
 */
export function DashboardMotion({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scope = root.current;
    if (!scope) return;

    const context = gsap.context(() => {
      // matchMedia is the reduced-motion branch. With `reduce` matching, the reveal
      // never plays and `gsap.set` puts everything at its final state -- so the
      // tiles are visible without the effect ever having run.
      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from('[data-reveal]', {
          opacity: 0,
          // 10px rather than 30: enough to read as an entrance, small enough that
          // nothing appears to fly in from off-screen.
          y: 10,
          duration: 0.42,
          ease: 'power2.out',
          // A short stagger, capped: a grid of nine tiles staggered over two seconds
          // makes the last one arrive after the reader has given up waiting.
          stagger: { each: 0.035, from: 'start' },
          clearProps: 'transform',
        });
      });

      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set('[data-reveal]', { clearProps: 'all' });
      });
    }, scope);

    return () => context.revert();
  }, []);

  return <div ref={root}>{children}</div>;
}

/**
 * A hover lift for a panel, in CSS rather than JS.
 *
 * The glass highlight already follows the pointer (see glass.tsx), and adding a JS
 * transform on top of that would fight it -- two effects writing the same composite
 * layer. The lift is a transition on the panel's own transform, which the compositor
 * handles without a tick of JavaScript per frame.
 */
export function LiftOnHover({ children }: { children: React.ReactNode }) {
  return <div className="pf-lift">{children}</div>;
}