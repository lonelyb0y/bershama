/**
 * Ask the server what it thinks of a reCAPTCHA token.
 *
 * One function, because the failure mode worth naming is the one where the client
 * decides on its own. If this call errors and the caller falls back to "assume it
 * passed", then suppressing the network is enough to skip the check -- which is the
 * same hole as the original bug, one layer out. So a transport failure is *refused*,
 * and the login form surfaces an error rather than proceeding on a guess.
 *
 * The distinction that does matter: a token the client never got is `null`, and that
 * is passed through as `null` for the server to judge. "I have no token" and "I could
 * not ask" are different, and conflating them is what made the old `if (token)`
 * guard possible.
 */

const LOGIN_ACTION = 'login';

export interface RecaptchaVerdict {
  ok: boolean;
  score: number | null;
  reason: 'ok' | 'not_configured' | 'missing_token' | 'too_low' | 'hard_floor' | 'verify_failed';
}

export async function verifyRecaptchaTokenViaRoute(
  token: string | null,
  action: string = LOGIN_ACTION,
): Promise<RecaptchaVerdict> {
  try {
    const response = await fetch('/api/recaptcha/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action }),
    });

    if (!response.ok && response.status !== 429) {
      return { ok: false, score: null, reason: 'verify_failed' };
    }

    return (await response.json()) as RecaptchaVerdict;
  } catch {
    // Refused, not assumed. See the note above.
    return { ok: false, score: null, reason: 'verify_failed' };
  }
}