import type { ReactNode } from 'react';

/**
 * A status, in a pill.
 *
 * ── why the label is not optional, and why neither is the shape ───────────────────
 *
 * The alert centre showed severity as a coloured dot. A red dot next to a grey dot is
 * a distinction that exists only for somebody who can see colour and already knows
 * which colour means what. It failed for colour-blind users, in greyscale printing, and
 * in a screen reader, which announced nothing at all.
 *
 * So status is carried three ways, and any one of them is enough:
 *
 *   1. the WORD       — "Critical", "Warning", "Info"
 *   2. the SHAPE      — a triangle, a circle, a square
 *   3. the COLOUR     — decoration on top
 *
 * The shape is what makes it survive a printed report. A QA inspector receives a
 * greyscale printout of the alert log; a red dot and an amber dot are the same dot.
 * A triangle is not a circle. Linear does the same thing in its inbox, and it is the
 * cheapest accessibility win available: it costs one SVG path per severity and it
 * removes an entire class of failure.
 */
export type BadgeTone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

/** The shape that goes with each tone. */
export type BadgeShape = 'circle' | 'square' | 'triangle' | 'diamond';

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: 'border-[color:var(--border)] text-[color:var(--text-muted)]',
  good: 'border-[var(--color-stock-ok)]/40 text-[var(--color-stock-ok)]',
  warn: 'border-[var(--color-stock-warning)]/40 text-[var(--color-stock-warning)]',
  bad: 'border-[var(--color-stock-critical)]/40 text-[var(--color-stock-critical)]',
  info: 'border-[color:var(--border)] text-[color:var(--text-muted)]',
};

const TONE_FILL: Record<BadgeTone, string> = {
  neutral: 'currentColor',
  good: 'currentColor',
  warn: 'currentColor',
  bad: 'currentColor',
  info: 'currentColor',
};

/**
 * The shape, drawn small.
 *
 * A triangle for the worst, a circle for the middle, a square for the least. Sized in
 * `em` so it scales with the badge's own type rather than sitting at a fixed pixel
 * size next to it.
 */
function Shape({ shape, className = '' }: { shape: BadgeShape; className?: string }) {
  const common = {
    width: '0.6em',
    height: '0.6em',
    viewBox: '0 0 10 10',
    'aria-hidden': true,
    focusable: false,
    className: `shrink-0 ${className}`,
  } as const;

  if (shape === 'triangle') {
    return (
      <svg {...common}>
        <path d="M5 0.5 L9.5 9 L0.5 9 Z" fill="currentColor" />
      </svg>
    );
  }
  if (shape === 'diamond') {
    return (
      <svg {...common}>
        <path d="M5 0 L10 5 L5 10 L0 5 Z" fill="currentColor" />
      </svg>
    );
  }
  if (shape === 'square') {
    return (
      <svg {...common}>
        <rect x="0.5" y="0.5" width="9" height="9" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="5" cy="5" r="4.5" fill="currentColor" />
    </svg>
  );
}

/** A shape for a tone, unless the caller says otherwise. */
export function toneShape(tone: BadgeTone): BadgeShape {
  switch (tone) {
    case 'bad':
      return 'triangle';
    case 'warn':
      return 'circle';
    case 'good':
      return 'diamond';
    default:
      return 'square';
  }
}

export function Badge({
  tone = 'neutral',
  shape,
  children,
  title,
  className,
}: {
  tone?: BadgeTone;
  /** Overrides the shape the tone would use. */
  shape?: BadgeShape;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none ${TONE_CLASS[tone]} ${className ?? ''}`}
    >
      <Shape shape={shape ?? toneShape(tone)} className={TONE_FILL[tone]} />
      {children}
    </span>
  );
}

/**
 * A number that must not be reordered by the surrounding text.
 *
 * A batch number, a quantity, a temperature and a timestamp are all LTR facts inside
 * an Arabic sentence. Without isolation the punctuation moves to the wrong end and
 * "LOT-2026-A0412" becomes unreadable. `<bdi>` is the element for exactly this: it
 * isolates the run without changing the page's direction.
 */
export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={className}>
      {children}
    </bdi>
  );
}
