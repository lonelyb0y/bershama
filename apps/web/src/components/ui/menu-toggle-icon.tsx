'use client';

/**
 * The menu toggle.
 *
 * ── why it is drawn rather than imported ──────────────────────────────────────
 *
 * The header's mobile sheet opens and closes, and the button has to show which
 * of those two it will do. That means the glyph has to change, and it has to
 * change on the SAME frame as the transition starts -- a swap that happens a
 * frame later reads as a flicker.
 *
 * So the two states are drawn as two paths and the `open` prop selects between
 * them. There is no animation in the icon itself: the sheet animates, and the
 * icon is a label for the button, not a second animation competing with it.
 */

export function MenuToggleIcon({
  open,
  className,
  duration = 300,
}: {
  open: boolean;
  className?: string;
  /** Kept for the caller's transition timing. The glyph does not animate. */
  duration?: number;
}) {
  void duration;

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      {open ? (
        <>
          <path d="M6 6L18 18" />
          <path d="M18 6L6 18" />
        </>
      ) : (
        <>
          <path d="M4 7H20" />
          <path d="M4 12H20" />
          <path d="M4 17H20" />
        </>
      )}
    </svg>
  );
}
