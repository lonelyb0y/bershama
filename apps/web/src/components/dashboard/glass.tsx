'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Glass surfaces.
 *
 * ── what is glass here, and what is not ──────────────────────────────────────
 * liquid-glass-js does real refraction: it samples what is behind each element and
 * bends it. That is the right effect for a single hero element over a photograph and
 * the wrong one for a dashboard with nine cards, because each element needs its own
 * readback of the backdrop and each readback is a GPU stall. Nine of them would make
 * the page stutter exactly when somebody is trying to read a stock figure.
 *
 * So this is CSS glass: the backdrop-filter blur and saturate that gives the
 * depth-and-translucency read, plus the specular highlight along the top edge that
 * sells it as a material with a surface. It costs the compositor one pass, holds its
 * frame rate on integrated graphics, and degrades to a plain panel where
 * backdrop-filter is unsupported.
 *
 * ── contrast is not negotiable ───────────────────────────────────────────────
 * The verified palette guarantees AA for text on the *page* background. Text on glass
 * is a third surface, so every panel here carries its own opaque-enough fill and the
 * foreground colour comes from the theme rather than from the backdrop. A panel is
 * never a transparent box over an animated field: contrast.spec.ts asserts the token
 * pairs, and these panels are built from those tokens.
 *
 * ── the parallax ─────────────────────────────────────────────────────────────
 * The highlight follows the pointer, which is the cheapest honest way to convey that
 * the surface has a normal. It is one CSS custom property write per pointer move,
 * disabled entirely for reduced motion and for coarse pointers -- a touch highlight
 * that follows a finger is just jitter.
 */

function useParallax(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!enabled || !node) return;

    let frame = 0;
    const onMove = (event: PointerEvent) => {
      // Coalesced to one write per frame. Pointermove fires far more often than the
      // compositor paints, and an uncapped handler here is the single easiest way to
      // make a "cheap" effect expensive.
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = node.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        node.style.setProperty('--pf-glass-x', `${x.toFixed(3)}`);
        node.style.setProperty('--pf-glass-y', `${y.toFixed(3)}`);
      });
    };

    node.addEventListener('pointermove', onMove);
    return () => {
      node.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled]);

  return ref;
}

export function GlassPanel({
  children,
  className = '',
  as: Tag = 'div',
  interactive = false,
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
  /** Adds the pointer-following highlight. For panels that are worth touching. */
  interactive?: boolean;
} & React.HTMLAttributes<HTMLElement>) {
  const [parallax, setParallax] = useState(false);

  // Enabled only once mounted, and only for a fine pointer that has not asked for
  // reduced motion -- both checked on the client because neither can be known on the
  // server, and a mismatch here would mean a highlight that jumps on hydration.
  useEffect(() => {
    if (!interactive) return;
    // Deferred for the same reason as everywhere else in this codebase: setState in
    // an effect body is a cascading render, and neither media query is needed within
    // the frame of the mount.
    const timer = setTimeout(() => {
      const fine = window.matchMedia?.('(pointer: fine)').matches ?? false;
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      setParallax(fine && !still);
    }, 0);
    return () => clearTimeout(timer);
  }, [interactive]);

  const ref = useParallax(parallax);

  return (
    <Tag
      ref={ref as never}
      className={`pf-glass ${interactive ? 'pf-glass--interactive' : ''} ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * A figure with a sparkline, on glass.
 *
 * The bar or the trend is the point of the tile, not decoration: a number with no
 * shape beside it gives no sense of direction, and "is stock going up or down" is the
 * question a dashboard exists to answer first.
 */
export function MetricTile({
  label,
  value,
  hint,
  trend,
  trendLabel,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  /** Recent values, oldest first. Rendered as a bar sparkline. */
  trend?: number[];
  trendLabel?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  const max = trend?.length ? Math.max(...trend) : 0;

  return (
    <GlassPanel className="pf-tile" as="div">
      <p className="pf-tile__label">{label}</p>
      <p className="pf-tile__value tabular">{value}</p>
      {hint && <p className="pf-tile__hint">{hint}</p>}

      {trend && trend.length > 1 && (
        <svg
          viewBox={`0 0 ${trend.length * 10} 24`}
          preserveAspectRatio="none"
          className="pf-tile__spark"
          role="img"
          aria-label={trendLabel ?? label}
        >
          {trend.map((point, index) => {
            // Zero is a real value for stock, so the bars are scaled from zero rather
            // than from the minimum: a chart that flattens a fall to nothing is
            // hiding the thing it exists to show.
            const height = max === 0 ? 0 : Math.max(1, (point / max) * 22);
            return (
              <rect
                key={index}
                x={index * 10 + 1}
                y={23 - height}
                width="8"
                height={height}
                rx="1.5"
                className={`pf-spark pf-spark--${tone}`}
              />
            );
          })}
        </svg>
      )}
    </GlassPanel>
  );
}

/**
 * The CSS gradient fallback, rendered as a fixed layer.
 *
 * Not a component for its own sake: it is what a browser without WebGL gets, and it
 * has to look deliberate rather than like the thing that failed to load.
 */
export function BackdropFallback({ dark }: { dark: boolean }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10"
      style={{
        background: dark
          ? 'radial-gradient(120% 90% at 20% 0%, #0b2c3d 0%, #06141f 55%, #040d14 100%)'
          : 'radial-gradient(120% 90% at 20% 0%, #f2fbfe 0%, #dcf1f9 55%, #cbe9f5 100%)',
      }}
    />
  );
}