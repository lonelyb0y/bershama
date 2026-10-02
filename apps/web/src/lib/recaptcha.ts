/**
 * reCAPTCHA v3, client half: the script and the token, and nothing else.
 *
 * ── why this file exists separately from `recaptcha-server.ts` ─────────────────
 *
 * The verification used to live in this file, and the login form imported it from
 * here. That made it dead code: this module is imported by a `'use client'`
 * component, so it is bundled for the browser, and `process.env.RECAPTCHA_SECRET_KEY`
 * does not exist in a browser -- it comes back `undefined`. Every call therefore
 * took the `if (!SECRET) return { ok: true }` branch and approved the submission.
 *
 * So the reCAPTCHA was not weak. It was **absent**, while the code, the comments and
 * the Vercel environment all said it was there. The whole feature looked done in
 * review and had never once asked Google anything.
 *
 * The fix is structural rather than a reminder to be careful: the secret is now read
 * in a module marked `'use server-only'`, which throws at *build* time if anything in
 * the client graph imports it. The mistake becomes impossible to reintroduce
 * quietly, and the build is the thing that catches it.
 *
 * ── what v3 is and is not ────────────────────────────────────────────────────
 * v3 never blocks anything by itself. It returns a score from 0.0 to 1.0 and shows
 * no challenge of its own, so "protect my login" means deciding what to do with that
 * score. That decision lives on the server.
 *
 * The token is single-use and short-lived: minted per submission, sent once, verified
 * once. A token minted while the user is still typing has expired by the time they
 * finish, which is why this is called on the real submit and not on a timer.
 */

const SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;

const SCRIPT_SRC = `https://www.google.com/recaptcha/api.js?render=${SITE_KEY ?? ''}`;

/** Public, so this is safe in a client module. The secret is not, and is not here. */
export function recaptchaSiteKey(): string | undefined {
  return SITE_KEY;
}

/**
 * Whether the *browser* half is configured.
 *
 * Note what this deliberately does not say: it says nothing about whether
 * verification is happening. Only the server can know that, because only the server
 * has the secret -- a client that asked would be told "yes" by a build with no keys
 * at all, and "yes" is exactly the answer that hides a misconfiguration.
 */
export function recaptchaClientConfigured(): boolean {
  return Boolean(SITE_KEY);
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
    // A token we could not get is reported as *no token*, not as a pass and not as a
    // failure. Only the server can tell whether that is acceptable, because only the
    // server knows whether verification was ever switched on -- and that decision
    // cannot belong here, or a bot could suppress the script and suppress the check
    // with it.
    return null;
  }
}