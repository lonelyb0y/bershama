import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The reCAPTCHA policy, tested rather than asserted in a comment.
 *
 * ── why these cases matter ────────────────────────────────────────────────────
 *
 * The feature shipped once already, and it never once asked Google anything: the
 * verification function lived in a module a client component imported, so the secret
 * read as `undefined` and every submission took the "no secret configured" branch.
 * It compiled, linted, passed 201 unit tests, and appeared in the Vercel environment
 * as configured.
 *
 * A test that only checked "does a high score pass" would not have caught that. What
 * caught it was reading the module. So the cases here are the ones where the *wrong*
 * answer is the plausible one:
 *
 *   * no secret configured -> allow, so preview builds and local dev still work;
 *   * Google unreachable -> allow, because a third-party outage is not evidence
 *     about the person;
 *   * a token that never arrived -> allow, and log it. This one is here because the
 *     opposite was shipped and locked every sign-in in production: reCAPTCHA issues no
 *     token to a blocked script, a privacy browser, or an automated browser, and a
 *     distributor who cannot sign in cannot dispense;
 *   * a low score -> refuse, and a very low one -> refuse *and* be distinguishable.
 *     That check is the protection that survives; requiring a token was not.
 *
 * The build cannot be tested from here, but it is also covered: `recaptcha-server.ts`
 * imports `server-only`, so a client component importing it fails the build, which is
 * verified by sabotaging the login form.
 */

const SECRET = 'test-secret';

async function loadModule(env: Record<string, string | undefined>) {
  // Re-imported per case: the module reads its configuration at import time, so a
  // single import with the first case's env would silently answer all the others.
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import('./recaptcha-server');
}

function siteverify(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  } as Response;
}

const ENV_KEYS = ['RECAPTCHA_SECRET_KEY', 'RECAPTCHA_LOGIN_MIN_SCORE', 'RECAPTCHA_LOGIN_HARD_FLOOR'];

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
});

describe('when verification is not configured', () => {
  it('allows the submission, so a preview build without keys still signs in', async () => {
    const { verifyRecaptchaToken, recaptchaVerificationEnabled } = await loadModule({
      RECAPTCHA_SECRET_KEY: undefined,
    });

    expect(recaptchaVerificationEnabled()).toBe(false);

    // No network call at all. A missing secret must not become an outbound request.
    const verdict = await verifyRecaptchaToken('some-token');
    expect(verdict).toEqual({ ok: true, score: null, reason: 'not_configured' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('when no token arrives', () => {
  // The regression test for the lockout. The first version of this policy refused here
  // and every sign-in in production failed within minutes, because reCAPTCHA issues no
  // token to a blocked script, a privacy browser, or an automated one.
  it('allows, because a missing token is not evidence of a bot', async () => {
    const { verifyRecaptchaToken } = await loadModule({ RECAPTCHA_SECRET_KEY: SECRET });

    const verdict = await verifyRecaptchaToken(null);

    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toBe('missing_token');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('when Google is reachable', () => {
  it('allows a good score and sends the action it is verifying for', async () => {
    const { verifyRecaptchaToken } = await loadModule({ RECAPTCHA_SECRET_KEY: SECRET });
    vi.mocked(fetch).mockResolvedValue(siteverify({ success: true, score: 0.9, action: 'login' }));

    const verdict = await verifyRecaptchaToken('token', { action: 'login' });

    expect(verdict).toEqual({ ok: true, score: 0.9, reason: 'ok' });

    // The action has to be bound server-side, or a token earned on some other form
    // on this site could be replayed here.
    const body = vi.mocked(fetch).mock.calls[0][1]?.body as URLSearchParams;
    expect(body.get('action')).toBe('login');
    expect(body.get('secret')).toBe(SECRET);
  });

  it('refuses a score below the minimum', async () => {
    const { verifyRecaptchaToken } = await loadModule({
      RECAPTCHA_SECRET_KEY: SECRET,
      RECAPTCHA_LOGIN_MIN_SCORE: '0.5',
      RECAPTCHA_LOGIN_HARD_FLOOR: '0.15',
    });
    vi.mocked(fetch).mockResolvedValue(siteverify({ success: true, score: 0.3, action: 'login' }));

    const verdict = await verifyRecaptchaToken('token', { action: 'login' });

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('too_low');
    expect(verdict.score).toBe(0.3);
  });

  it('distinguishes a very low score, so it can be treated as an attack signal', async () => {
    const { verifyRecaptchaToken } = await loadModule({
      RECAPTCHA_SECRET_KEY: SECRET,
      RECAPTCHA_LOGIN_MIN_SCORE: '0.5',
      RECAPTCHA_LOGIN_HARD_FLOOR: '0.15',
    });
    vi.mocked(fetch).mockResolvedValue(siteverify({ success: true, score: 0.02, action: 'login' }));

    const verdict = await verifyRecaptchaToken('token', { action: 'login' });

    expect(verdict.reason).toBe('hard_floor');
  });

  it('refuses a token minted for a different action', async () => {
    const { verifyRecaptchaToken } = await loadModule({ RECAPTCHA_SECRET_KEY: SECRET });
    vi.mocked(fetch).mockResolvedValue(siteverify({ success: true, score: 0.9, action: 'signup' }));

    const verdict = await verifyRecaptchaToken('token', { action: 'login' });

    expect(verdict.ok).toBe(false);
  });
});

describe('when verification does not produce a score', () => {
  it('allows on success with no score, since v3 does not always score', async () => {
    const { verifyRecaptchaToken } = await loadModule({ RECAPTCHA_SECRET_KEY: SECRET });
    vi.mocked(fetch).mockResolvedValue(siteverify({ success: true }));

    const verdict = await verifyRecaptchaToken('token');

    expect(verdict.ok).toBe(true);
    expect(verdict.score).toBeNull();
  });

  it('does not treat a replayed token as a pass', async () => {
    // `timeout-or-duplicate` is what a second verification of the same token returns.
    // Google's `success: false` is checked first, and an allow there would make replay
    // free -- a bot could reuse one good token for a burst of attempts.
    const { verifyRecaptchaToken } = await loadModule({ RECAPTCHA_SECRET_KEY: SECRET });
    vi.mocked(fetch).mockResolvedValue(
      siteverify({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
    );

    const verdict = await verifyRecaptchaToken('token');

    expect(verdict.reason).toBe('verify_failed');
    expect(verdict.score).toBeNull();
  });

  it('allows when Google is unreachable, because an outage is not evidence', async () => {
    const { verifyRecaptchaToken } = await loadModule({ RECAPTCHA_SECRET_KEY: SECRET });
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));

    const verdict = await verifyRecaptchaToken('token');

    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toBe('verify_failed');
  });
});