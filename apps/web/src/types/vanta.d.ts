/**
 * Types for the two modules the animated home background uses.
 *
 * ── why they are declared here rather than installed ──────────────────────────
 *
 * `@types/three` is a large package that describes a library this code does not
 * use directly: three.js is imported for exactly one reason, which is to put a
 * global where Vanta can find it, because Vanta was written against a
 * three.js that predates the current major and looks for `window.THREE`.
 *
 * Vanta ships no types at all, and its effect files are UMD bundles, so there is
 * nothing to install either.
 *
 * So the surface is declared here, and it is deliberately small: the options
 * this component actually sets, and the one method it calls on the way out.
 */

declare module 'three' {
  const THREE: unknown;
  export default THREE;
}

declare module 'vanta/dist/vanta.dots.min' {
  export interface VantaInstance {
    /** Vanta exposes `destroy` on the effect it returns. */
    destroy?: () => void;
  }

  export interface VantaOptions {
    /** The element the canvas is drawn into. */
    el: HTMLElement | string;
    /** A point colour, as a 24-bit integer. */
    color?: number;
    /** A background colour, as a 24-bit integer. */
    backgroundColor?: number;
    /** 0 is transparent. */
    backgroundAlpha?: number;
    /** How strongly the pointer pushes the points around. */
    mouseSensitivity?: number;
    /** How dense the field is. */
    scale?: number;
    /** How fast it drifts. */
    speed?: number;
  }

  export default function DOTS(options: VantaOptions): VantaInstance;
}
