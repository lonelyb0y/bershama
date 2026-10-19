/**
 * Which accounts the browser suite signs in as.
 *
 * ── why this is not hard-coded ──────────────────────────────────────────────────
 *
 * It was, and it is why the Browser job could not survive the demo tenant being
 * deleted. The suite pointed at admin@demo.local, so every pull request needed those
 * accounts to exist in whatever database the preview deployment was talking to — and a
 * preview shares the project's database, so that meant production had to ship throwaway
 * credentials.
 *
 * Now there are two fixtures and the suite is told which one it is running against:
 *
 *   local, against `make db` + the seed   -> the demo accounts, unchanged
 *   CI, against the hosted project         -> the ci-* accounts from
 *                                             migration 20260101000077
 *
 * The defaults are the demo addresses, so a local run that changes nothing behaves
 * exactly as it did before.
 */
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'PharmaFlow#2026';

export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@demo.local';
export const PHARMACY_EMAIL = process.env.E2E_PHARMACY_EMAIL ?? 'pharmacy@demo.local';
export const DRIVER_EMAIL = process.env.E2E_DRIVER_EMAIL ?? 'driver@demo.local';

/**
 * The administrator's display name, which auth.spec.ts asserts on.
 *
 * Parameterised for the same reason as the addresses: the fixture's administrator is
 * called "CI Admin", so asserting the seeded name unconditionally would fail CI with a
 * message about a missing name rather than about a sign-in.
 */
export const ADMIN_NAME = process.env.E2E_ADMIN_NAME ?? 'Ahmed Hassan';