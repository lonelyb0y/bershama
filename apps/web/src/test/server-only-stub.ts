/**
 * A no-op stand-in for `server-only`, used only by vitest.
 *
 * See the note in `vitest.config.mts` for why this exists and why removing it would
 * be the wrong fix. The real guard is enforced by `pnpm build`; this file exists only
 * so a unit test can import a server module without the RSC runtime's export
 * condition, and it must stay empty.
 */
export {};