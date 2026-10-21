/**
 * The dashboard reveal.
 *
 * ── why this is CSS and not a library ────────────────────────────────────────
 *
 * This used to be GSAP: 78 lines, a `matchMedia` branch, a `context.revert()` on
 * teardown, and around seventy kilobytes of gzipped JavaScript on the one page
 * that most needed to be fast.
 *
 * The effect it produced is a fade and a ten-pixel rise, staggered across four
 * elements by thirty-five milliseconds each. That is a CSS animation with an
 * `animation-delay`, and CSS does it on the compositor with no JavaScript at
 * all -- no bundle, no hydration, no per-frame tick.
 *
 * The stagger is expressed with `:nth-child` rather than an index set in
 * JavaScript, which is what removes the need for the library: the browser
 * already knows the order.
 *
 * And because the component is now a plain element with a class, it is no longer
 * a client component. The dashboard's reveal ships zero JavaScript.
 */

/**
 * A hover lift for a panel, in CSS rather than JS.
 *
 * The glass highlight already follows the pointer (see glass.tsx), and adding a
 * JS transform on top of that would fight it -- two effects writing the same
 * composite layer. The lift is a transition on the panel's own transform, which
 * the compositor handles without a tick of JavaScript per frame.
 */
export function DashboardMotion({ children }: { children: React.ReactNode }) {
  return <div className="pf-reveal-scope">{children}</div>;
}

export function LiftOnHover({ children }: { children: React.ReactNode }) {
  return <div className="pf-lift">{children}</div>;
}
