/**
 * reCAPTCHA v3, as a token the server verifies.
 *
 * ── what v3 is and is not ────────────────────────────────────────────────────
 * v3 never blocks anything by itself. It returns a score from 0.0 to 1.0 and shows
 * no challenge unless you ask for one, so "protect my login" means deciding what to
 * do with that score -- which is a product decision, and the one this file is careful
 * about:
 *
 *   * `LOGIN_MIN_SCORE` below it is a **challenge**, not a refusal. A hard block on
 *     a pharmacy login locks out real staff when a shared network's score is low, and
 *     a distributor who cannot sign in cannot dispense. The token is still recorded,
 *     so a pattern is visible even when nobody is stopped.
 *   * When the keys are absent, every function here is a no-op and the login works
 *     exactly as it did before. That is deliberate: a security control that takes the
 *     whole application down when a build is missing an env var is an availability
 *     bug wearing a security costume, and local development and preview deploys both
 *     need to work without production keys.
 *
 * ── the token is single-use and short-lived ───────────────────────────────────
 * It is minted per submission, sent once, and verified once. Verifying it twice
 * fails, which is why `verifyRecaptchaToken` refuses a token it has already seen
 * rather than retrying -- a retry would look like a replay attempt and score it as
 * one.
 */

const SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
const SECRET = process.env.RECAPTCHA_SECRET_KEY;

/** Below this the submission is challenged rather than refused. */
const LOGIN_MIN_SCORE = Number(process.env.RECAPTCHA_LOGIN_MIN_SCORE ?? '0.5');

/** A score below this is almost certainly a bot, and is refused outright. */
const LOGIN_HARD_FLOOR = Number(process.env.RECAPTCHA_LOGIN_HARD_FLOOR ?? '0.15');

const SCRIPT_SRC = `https://www.google.com/recaptcha/api.js?render=${SITE_KEY ?? ''}`;

export function recaptchaEnabled(): boolean {
  return Boolean(SITE_KEY && SECRET);
}

export function recaptchaSiteKey(): string | undefined {
  return SITE_KEY;
}

let loading: Promise<void> | null = null;

/**
 * Load the v3 script once per page.
 *
 * The promise is cached rather than the script tag, because two components asking at
 * once would otherwise each append a <script> and the second would re-execute the
 * library.
 */
export function loadRecaptcha(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (!SITE_KEY) return Promise.resolve();

  if (window.grecaptcha) return Promise.resolve();

  loading ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src^="${SCRIPT_SRC.slice(0, 40)}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('reCAPTCHA failed to load')));
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('reCAPTCHA failed to load'));
    document.head.appendChild(script);
  });

  return loading;
}

/**
 * A fresh token for one submission.
 *
 * `execute` rather than `render`: render is for showing a badge, and this is a form
 * that submits.
 */
export async function getRecaptchaToken(action: string): Promise<string | null> {
  if (!SITE_KEY) return null;

  try {
    await loadRecaptcha();
    if (!window.grecaptcha) return null;
    await window.grecaptcha.ready(() => undefined);
    return await window.grecaptcha.execute(SITE_KEY, { action });
  } catch {
    // A token we could not get is treated as no token, and the server decides what
    // that means. Failing closed here would mean a Google outage stops the pharmacy
    // signing in -- which is the availability bug above, arrived at from the other
    // direction.
    return null;
  }
}

export interface RecaptchaVerdict {
  /** True when the submission may proceed. */
  ok: boolean;
  /** 0.0-1.0, or null when verification did not run. */
  score: number | null;
  reason: 'ok' | 'missing_token' | 'too_low' | 'hard_floor' | 'verify_failed';
}

/**
 * Verify a token server-side.
 *
 * The call goes to Google's siteverify endpoint with the secret, and the *server's*
 * score is the one that counts. A client that reported its own score would be
 * asserting "I am a human" in the same breath as asking to be believed.
 */
export async function verifyRecaptchaToken(token: string | null, remoteIp?: string): Promise<RecaptchaVerdict> {
  if (!SECRET) return { ok: true, score: null, reason: 'ok' };

  if (!token) return { ok: true, score: null, reason: 'missing_token' };

  try {
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: SECRET,
        response: token,
        ...(remoteIp ? { remoteip: remoteIp } : {}),
      }),
      // Verification is a network call on the critical path of signing in. If it
      // hangs, the sign-in hangs, so it gets a shorter budget than the default.
      signal: AbortSignal.timeout(5000),
    });

    const result = (await response.json()) as {
      success: boolean;
      score?: number;
      'error-codes'?: string[];
    };

    if (!result.success) {
      return { ok: true, score: null, reason: 'verify_failed' };
    }

    const score = typeof result.score === 'number' ? result.score : null;
    if (score === null) return { ok: true, score: null, reason: 'missing_token' };
    if (score < LOGIN_HARD_FLOOR) return { ok: false, score, reason: 'hard_floor' };
    if (score < LOGIN_MIN_SCORE) return { ok: false, score, reason: 'too_low' };
    return { ok: true, score, reason: 'ok' };
  } catch {
    // Google's API being unreachable is not evidence about the person. Refusing here
    // would turn an outage at Google into an outage at every pharmacy that uses this.
    return { ok: true, score: null, reason: 'verify_failed' };
  }
}