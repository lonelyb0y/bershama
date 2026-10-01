/**
 * The slice of the reCAPTCHA v3 API this application uses.
 *
 * Declared by hand rather than pulled from `@types/recaptcha__v3` because that
 * package also declares an `execute` that returns `void`, which is not what v3 does:
 * `execute` resolves with a token. Installing a definition that contradicts the
 * behaviour the login form relies on in order to write `await grecaptcha.execute()`
 * would be worse than six lines written against the actual API.
 */
interface Recaptcha {
  ready(callback: () => void): void;
  execute(siteKey: string, options: { action: string }): Promise<string>;
}

interface Window {
  grecaptcha?: Recaptcha;
}
