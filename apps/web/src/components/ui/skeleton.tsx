import type { HTMLAttributes } from 'react';

import { cn } from "cn"

/**
 * A loading placeholder.
 *
 * ── why this exists ──────────────────────────────────────────────────────────
 *
 * Every route in this app is a server component that awaits the database before it
 * sends anything, so a navigation shows a blank screen for as long as the query
 * takes -- on the dashboard, on a slow connection, between 300 ms and 2 s depending
 * on the round trip. There were no `loading.tsx` files at all, so that wait was
 * silent.
 *
 * ── why it pulses, and why nothing else ───────────────────────────────────────
 *
 * The shimmer is a mask travelling across the placeholder, which is the standard
 * treatment and the one Uiverse's loaders converge on. It is deliberately the only
 * motion in the component. A skeleton that also bounces, rotates or shimmers its
 * border is three signals saying the same thing, and the extra ones are what makes
 * a loading state feel like a toy.
 *
 * ── accessibility ────────────────────────────────────────────────────────────
 *
 * The shimmer is decorative and hidden from assistive technology; what a screen
 * reader gets is `aria-busy` on the region and real text from the loading file that
 * renders it. A skeleton with no text is a silent blank region, which is worse than
 * no skeleton -- so every usage here is paired with a translated status line.
 *
 * `prefers-reduced-motion` stops the sweep and leaves a static placeholder, which
 * still communicates "something is here, not yet filled in".
 */

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn('pf-skeleton rounded-lg bg-current/10', className)}
      {...props}
    />
  );
}

/**
 * A skeleton shaped like a line of text, at one of the sizes the app actually uses.
 *
 * `width` accepts the same CSS length values a real element would, so a skeleton can
 * mirror the exact metrics of the content it stands in for -- which is the entire
 * point. A skeleton of the wrong height makes the page jump when the data lands.
 */
export function SkeletonText({
  width = '100%',
  size = 'md',
  className,
}: {
  width?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const heights = { sm: 'h-3', md: 'h-4', lg: 'h-5', xl: 'h-8' } as const;
  return <Skeleton className={cn(heights[size], className)} style={{ width }} />;
}

/**
 * A card-shaped skeleton, for the dashboard and list surfaces.
 *
 * Composed rather than monolithic so a route's loading file can mirror its own
 * layout: four of these for the dashboard's stat row, three for a three-up grid.
 */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('pf-glass rounded-2xl p-4', className)}>
      <SkeletonText size="sm" width="45%" />
      <SkeletonText size="xl" className="mt-3" width="60%" />
      <SkeletonText size="sm" className="mt-2" width="80%" />
    </div>
  );
}

/**
 * A row placeholder for tables and card lists.
 *
 * `columns` sets how many cells, because a table skeleton with three cells inside a
 * five-column table is visible for exactly as long as it takes to notice.
 */
export function SkeletonRow({ columns = 4 }: { columns?: number }) {
  return (
    <div className="flex items-center gap-4 py-3">
      {Array.from({ length: columns }, (_, i) => (
        <Skeleton
          key={i}
          className="h-4 flex-1"
          // The first column is the widest in every table here, so it gets the extra
          // width rather than every cell being identical.
          style={{ flexGrow: i === 0 ? 2 : 1 }}
        />
      ))}
    </div>
  );
}