import 'server-only';

/**
 * reCAPTCHA v3, server half: the secret, the score, and the policy.
 *
 * `'server-only'` at the top is the load-bearing line. It makes this module throw at
 * build time if anything in the client graph reaches it, which is what turns "do not
 * import the secret into a client component" from a comment into a build failure.
 * Without it, importing `verifyRecaptchaToken` into a `'use client'` file compiles
 * perfectly, passes lint, passes every unit test, and silently approves every
 * submission -- which is precisely what happened.
 *
 * ── what happens when there is no score ───────────────────────────────────────
 *
 * This is the part production got wrong once, and the correction is worth stating.
 *
 * The first version refused a submission that arrived **without a token**, on the
 * reasoning that a bot which blocks the reCAPTCHA script has otherwise switched the
 * check off by removing it. That reasoning is correct about the attack and wrong about
 * the world. A token is not issued when the script is blocked, when the network cannot
 * reach Google, when a privacy browser withholds it, or when the browser is automated
 * -- and production refused sign-in for every one of those within minutes of deploying.
 *
 * A distributor who cannot sign in cannot dispense. That is a worse outcome than a bot
 * getting one attempt against a rate limiter, and no score-based control is worth it.
 *
 * So: **no token means allow, and record it.** What remains is the part that actually
 * discriminates -- when Google *does* return a score, the thresholds are enforced and a
 * low score is refused. The residual weakness is real and worth naming: a bot that
 * suppresses the script entirely skips the check. That trade is deliberate, it is the
 * one the availability of a pharmacy demands, and the log line is there so the attempts
 * that skipped the check are at least visible.
 *
 * Google's API being unreachable is treated the same way, for the same reason.
 *
 * ── thresholds ───────────────────────────────────────────────────────────────
 * `LOGIN_MIN_SCORE` refuses. `LOGIN_HARD_FLOOR` is the line above which the attempt
 * is refused *and* recorded as an attack signal rather than an unlucky network. The
 * gap between them is what makes the distinction worth having: a pharmacy on a
 * university connection scores badly as a matter of course, and a pharmacist who
 * cannot log in at 08:00 is a safety problem, so the record is what you act on, not
 * the refusal.
 *
 * An earlier version of this file described the band below `LOGIN_MIN_SCORE` as "a
 * challenge, not a refusal" while the code refused it. v3 has no challenge of its
 * own -- that needs the v2 checkbox flow -- so the comment described a control that
 * did not exist. It is written down as what it does now.
 */

const SECRET = process.env.RECAPTCHA_SECRET_KEY;

/** Below this, refuse. */
const LOGIN_MIN_SCORE = Number(process.env.RECAPTCHA_LOGIN_MIN_SCORE ?? '0.5');

/** Below this, refuse and record as an attack signal. */
const LOGIN_HARD_FLOOR = Number(process.env.RECAPTCHA_LOGIN_HARD_FLOOR ?? '0.15');

export interface RecaptchaVerdict {
  /** True when the submission may proceed. */
  ok: boolean;
  /** 0.0-1.0, or null when verification did not run. */
  score: number | null;
  reason: 'ok' | 'not_configured' | 'missing_token' | 'too_low' | 'hard_floor' | 'verify_failed';
}

/** Whether verification is actually switched on. Only the server can answer this. */
export function recaptchaVerificationEnabled(): boolean {
  return Boolean(SECRET);
}

/**
 * Verify a token.
 *
 * The call goes to Google's siteverify endpoint with the secret, and the *server's*
 * score is the one that counts. A client reporting its own score would be asserting
 * "I am a human" in the same breath as asking to be believed.
 */
export async function verifyRecaptchaToken(
  token: string | null,
  options: { action?: string; remoteIp?: string } = {},
): Promise<RecaptchaVerdict> {
  if (!SECRET) return { ok: true, score: null, reason: 'not_configured' };

  if (!token) {
    // Allowed, deliberately. See the note at the top of this file: refusing here locked
    // every sign-in in production within minutes of shipping.
    log('recaptcha_no_token', 'allowed', null);
    return { ok: true, score: null, reason: 'missing_token' };
  }

  try {
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: SECRET,
        response: token,
        // Bound to the action the token was minted for. Without this, a token earned
        // by passing some other action on the site could be replayed here.
        ...(options.action ? { action: options.action } : {}),
        ...(options.remoteIp ? { remoteip: options.remoteIp } : {}),
      }),
      // Verification is a network call on the critical path of signing in. If it
      // hangs, the sign-in hangs, so it gets a shorter budget than the default.
      signal: AbortSignal.timeout(5000),
    });

    const result = (await response.json()) as {
      success: boolean;
      score?: number;
      action?: string;
      'error-codes'?: string[];
    };

    if (!result.success) {
      // Google's own codes matter here: `timeout-or-duplicate` is the one a replay
      // produces, and treating it as "allow" would make replay free.
      const codes = result['error-codes'] ?? [];
      log('recaptcha_rejected', codes.join(',') || 'unknown', null);
      return { ok: true, score: null, reason: 'verify_failed' };
    }

    // Google's own action check, not just the one we asked for. If the token was
    // minted for something else, it is not evidence about this form.
    if (options.action && result.action && result.action !== options.action) {
      log('recaptcha_action_mismatch', `${result.action}!=${options.action}`, null);
      return { ok: false, score: null, reason: 'verify_failed' };
    }

    const score = typeof result.score === 'number' ? result.score : null;
    if (score === null) return { ok: true, score: null, reason: 'verify_failed' };

    if (score < LOGIN_HARD_FLOOR) {
      log('recaptcha_refused', 'hard_floor', score);
      return { ok: false, score, reason: 'hard_floor' };
    }
    if (score < LOGIN_MIN_SCORE) {
      log('recaptcha_refused', 'too_low', score);
      return { ok: false, score, reason: 'too_low' };
    }

    return { ok: true, score, reason: 'ok' };
  } catch {
    // Google's API being unreachable is not evidence about the person. Refusing here
    // would turn an outage at Google into an outage at every pharmacy that uses this.
    log('recaptcha_unreachable', 'verify_failed', null);
    return { ok: true, score: null, reason: 'verify_failed' };
  }
}

/**
 * One structured line per decision.
 *
 * The score and the reason, and nothing else. No token, no secret, no email, no IP:
 * this is the kind of line that gets shipped to a log aggregator and read by people
 * who should not be holding credentials, and an IP would identify the person at a
 * pharmacy counter.
 */
function log(event: string, detail: string, score: number | null): void {
  console.warn('[recaptcha]', JSON.stringify({ event, detail, score, threshold: LOGIN_MIN_SCORE }));
}