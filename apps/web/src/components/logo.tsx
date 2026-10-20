import { type SVGProps } from 'react';

/**
 * The Bershama mark.
 *
 * Drawn rather than imported, and kept to basic geometry, for three reasons
 * that are all about how it actually gets used:
 *
 *  1. It has to stay legible at 20px in a header. Fine detail that looks
 *     considered at 512px turns to mud at that size, and this mark is only ever
 *     seen small.
 *
 *  2. It has to work on both themes without a second asset. Everything is
 *     `currentColor` plus one brand token, so it inherits the text colour of
 *     whatever it sits in and the dark theme needs no alternate file.
 *
 *  3. It has to survive an Arabic build of the interface. The wordmark is
 *     separated from the glyph and composed with the document direction, so the
 *     Arabic header reads Bers → hama with the mark on the correct side, rather
 *     than the Latin letters being reversed by `dir="rtl"`.
 *
 *     The wordmark splits where the glyph splits, because the two are one idea: a
 *     capsule cut on the diagonal, and a name cut on the same diagonal. Bers and
 *     hama are four letters each, so the seam falls in the middle of the word
 *     the way it falls in the middle of the mark.
 *
 * The shape: a capsule cut on the diagonal. A pill is the pharmacy; the
 * diagonal split is the two halves a distributor moves between them, and it
 * reads as direction without an arrow. It is deliberately not a cross — a cross
 * is a red cross, and putting one on a pharmaceutical product is a trade-mark
 * problem in most markets.
 */
export function LogoMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-hidden="true"
      {...props}
    >
      <title>Bershama</title>
      <defs>
        <linearGradient id="bsh-capsule" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-brand-500)" />
          <stop offset="100%" stopColor="var(--color-brand-700)" />
        </linearGradient>
      </defs>

      {/*
        The capsule body: a rounded rectangle rotated 45°, so the diagonal split
        reads as a clean vertical seam once rotated. Rotating a rect rather than
        pathing the capsule by hand means the corner radii stay perfectly
        circular at any size, which is exactly what goes wrong when a designer
        approximates one with bezier curves.
      */}
      <g transform="rotate(45 16 16)">
        <rect x="7" y="11" width="18" height="10" rx="5" fill="url(#bsh-capsule)" />
        {/* The half that has already travelled. Slightly recessed rather than a
            different colour, so the mark still reads as one object. */}
        <path d="M12 11h5v10h-5a5 5 0 0 1 0-10Z" fill="white" fillOpacity="0.92" />
      </g>
    </svg>
  );
}

/**
 * Mark plus wordmark, as one header unit.
 *
 * The wordmark is a text run rather than outlined shapes, which means it stays
 * crisp, stays selectable/searchable, and follows the page's font. Outlining it
 * would fix the shape and break every one of those.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <LogoMark className="size-6 shrink-0" />
      <span className="text-base font-semibold tracking-tight">
        Bers<span className="text-[color:var(--color-brand-600)]">hama</span>
      </span>
    </span>
  );
}
