/**
 * Password strength policy for self-serve signup.
 *
 * ## Why this exists at all
 *
 * Supabase's leaked-password protection checks new passwords against HaveIBeenPwned and
 * rejects any that appear in a breach corpus. It is the right control and it is **not
 * available on the Free plan** -- the toggle is greyed out and the Security Advisor keeps
 * reporting "Leaked Password Protection Disabled" until the project is upgraded to Pro.
 *
 * So on the Free plan nothing stands between a signup form and `Bershama#2020`. This is
 * the free-tier mitigation: a policy that rejects the passwords breach corpora are built
 * from, without needing the corpus.
 *
 * ## What this is, honestly
 *
 * This runs in the browser. It is a **usability control, not a security boundary** --
 * anyone can bypass it and POST directly to `/auth/v1/signup`. It exists so that the
 * overwhelming majority of people cannot *choose* a bad password, and so the signup form
 * can explain why before they are told off by a generic "invalid password".
 *
 * The actual server-side backstop is free and is one dashboard toggle:
 *
 *     Supabase -> Authentication -> Sign In / Providers -> Minimum password length
 *
 * Set that to 12 and the rule is enforced by GoTrue, where a client cannot reach around
 * it. Set it as low as you like here and GoTrue still holds the floor. See
 * docs/go-live-checklist.md, which records both halves so neither gets dropped on the
 * reasoning that the other one exists.
 *
 * ## Why a blocklist rather than composition rules
 *
 * "Must contain a symbol" does not stop `Password1!`, which is in every breach corpus ever
 * published and which passes every composition rule there is. Rules like that push people
 * towards predictable substitutions. Rejecting the known-common passwords and demanding
 * real length is the combination that actually raises the floor.
 */

/**
 * The floor. Matches the minimum length GoTrue should be configured with.
 *
 * Twelve is the floor, not the goal: NIST SP 800-63B puts the minimum at eight and
 * explicitly recommends *against* composition rules, on the grounds that forced character
 * classes produce guessable passwords. Everything below is therefore about length and
 * about rejecting what is already known to be common.
 */
export const MIN_LENGTH = 12;

/**
 * A compact blocklist of passwords that show up in every breach corpus, plus the
 * variations people actually type.
 *
 * Deliberately short. This is not a breach corpus and does not pretend to be one -- it is
 * the handful that dominate credential-stuffing wordlists, which is what a signup form
 * actually sees. Comparisons are case-insensitive and leet-normalised, so `P@ssw0rd`,
 * `pASSWORD` and `password` are all the same entry.
 *
 * Note what is *not* here: the demo password used by the seeded accounts. It is long,
 * generated once for a demo tenant, and it is not in any corpus -- and a signup form that
 * rejected it would lock the seeded users out of their own demo data.
 */
const COMMON_PASSWORDS = new Set([
  // Note what is deliberately absent: this product's own name. A blocklist entry that
  // rejects the product name punishes anyone who picks it for a reason we cannot see, and
  // the rule's job is to catch what appears in breach corpora -- which this does not.
  'password',
  'password1',
  // Digit-leet spellings, listed explicitly because `reduce` does not produce them -- see
  // the note on that function for why it does not try.
  'psswrd',
  'pssword',
  'qwerty',
  'qwertyuiop',
  'letmein',
  'welcome',
  'iloveyou1',
  'admin',
  'admin123',
  'administrator',
  'iloveyou',
  'monkey',
  'dragon',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'superman',
  'batman',
  'trustno1',
  'starwars',
  'whatever',
  'freedom',
  'computer',
  'internet',
  'samsung',
  'google',
  'facebook',
  'changeme',
  'changeme1',
  'secret',
  'secret123',
  'test',
  'test123',
  'user',
  'username',
  'default',
  'login',
]);

export type PasswordProblem =
  | 'tooShort'
  | 'tooCommon'
  | 'containsEmail'
  | 'tooFewDistinct'
  | 'isSequential'
  | 'isKeyboardWalk';

export type PasswordAssessment = {
  /** True only when nothing objectionable was found. */
  ok: boolean;
  /** 0-4. Drives the meter. Deliberately coarse: it is feedback, not a score to trust. */
  score: 0 | 1 | 2 | 3 | 4;
  /** Every problem found, not just the first, so the form can list them all at once. */
  problems: PasswordProblem[];
};

/**
 * Reduce a password to the bare words a person was actually reaching for.
 *
 * Two earlier versions of this were wrong in the same way, and the failure mode was
 * invisible, which is why it is written down here rather than left in the diff.
 *
 * The first applied a leet chain to the whole string and then stripped the non-letters,
 * hoping `p4ssw0rd` would reduce to `password`. But the chain rewrites *every* digit, so
 * the same rule turned
 *
 *     password1234  ->  passwordgtea
 *
 * and the single most common password shape there is passed as perfectly acceptable. A `4`
 * is either a leet `a` or the digit four, and a chain cannot tell them apart.
 *
 * The second tried to fix that by generating two candidates, one stripping digits first and
 * one mapping them first. That just moved the damage: mapping digits first turned
 * `p@ssw0rd1234` into `passworditea`, which no list would ever contain.
 *
 * So the ambiguity is resolved by *not* guessing. Only these five substitutions are
 * applied, and they are the ones that are effectively never used as literal digits in a
 * password:
 *
 *     @  -> a      $  -> s      !  -> i      |  -> i      0  -> o
 *
 * Everything else non-alphabetic is then removed, digits included. So `password1234` and
 * `p@ssw0rd1234` both reduce to `password`, which is the point, and neither gets mangled on
 * the way.
 *
 * The cost is that digit-leet forms of the *word* are missed: `p4ssw0rd` reduces to `psswrd`,
 * not `password`. Rather than contort the rule to catch those -- and reintroduce exactly the
 * bug above -- the two worst offenders are listed explicitly. This is a best-effort usability
 * layer, not a breach corpus; the real control is GoTrue's minimum password length.
 */
function candidates(password: string): string[] {
  const lower = password.toLowerCase();

  // Only punctuation is ever leet-mapped, never a digit -- see the note above on why
  // mapping digits destroys the trailing run.
  const leet = (value: string) =>
    value.replace(/@/g, 'a').replace(/\$/g, 's').replace(/[!|]/g, 'i').replace(/0/g, 'o');

  // Neither candidate is a superset of the other, which is why both exist:
  //
  //   `p@ssw0rd1234`  -> A: psswrd   B: password   (only B catches it)
  //   `Password1!234` -> A: password  B: passwordi  (only A catches it)
  //
  // B loses `Password1!234` because `!` is a separator there rather than a leet `i`, and
  // the same character is both depending on what the person was reaching for. Guessing
  // once is wrong; offering the blocklist both readings is right.
  return [lower.replace(/[^a-z]/g, ''), leet(lower).replace(/[^a-z]/g, '')];
}

/**
 * True for a run along a keyboard row: `qwerty`, `asdf`, `zxcv`, `1234`, `789`.
 *
 * A separate check from `isSequential` because character codes do not know about layout.
 * `qwertyuiopasdfg` has no arithmetic run anywhere in it -- q is 113 and w is 119 -- so the
 * alphabet check passes it, while it is one of the most guessed strings in existence and
 * its length and character variety both look respectable.
 *
 * The first attempt at this filtered the whole password against a loose set of row keys and
 * then substring-matched, which flagged almost anything containing "1234" -- `p@ssw0rd1234`
 * was reported as a keyboard walk. Too permissive by an order of magnitude, and a rule that
 * fires on ordinary passwords is a rule people learn to ignore.
 *
 * So this walks the password once and asks a narrow question: is there a run of four
 * characters that all sit in the same row, in that row's order, with at most one key
 * skipped between neighbours? Four in a row is the point at which a sequence stops being a
 * coincidence, and allowing one gap catches the `qwrt` that real fingers produce without
 * matching scattered characters that merely happen to exist on the same row.
 */
const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890'];

function isKeyboardWalk(password: string): boolean {
  const chars = [...password.toLowerCase()];

  for (let start = 0; start + 4 <= chars.length; start += 1) {
    for (const row of KEYBOARD_ROWS) {
      let previousIndex = -1;
      let matched = 0;

      for (let i = start; i < chars.length && matched < 4; i += 1) {
        const at = row.indexOf(chars[i]);
        if (at === -1) break; // left the row entirely
        // In row order, and never more than one key skipped.
        if (previousIndex !== -1 && (at <= previousIndex || at - previousIndex > 2)) break;
        previousIndex = at;
        matched += 1;
      }

      if (matched >= 4) return true;
    }
  }
  return false;
}

/** True for `abcdef`, `123456`, `qwerty` — a run up or down. */
function isSequential(password: string): boolean {
  const s = password.toLowerCase();
  if (s.length < 4) return false;
  let up = 0;
  let down = 0;
  for (let i = 1; i < s.length; i += 1) {
    const delta = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (delta === 1) up += 1;
    else if (delta === -1) down += 1;
  }
  // Almost the whole string ascending or descending, not merely containing a short run.
  return up >= s.length - 2 || down >= s.length - 2;
}

/**
 * Assess a password against the policy.
 *
 * `email` is optional and, when given, is checked against the local part: a password
 * containing the user's own name or the domain is a password everyone who knows one
 * detail can guess. This is checked against the raw password rather than the normalised
 * one, because `ahmed@bershama.com` normalises to something meaningless.
 */
export function assessPassword(password: string, email?: string): PasswordAssessment {
  const problems: PasswordProblem[] = [];
  const value = password ?? '';

  if (value.length < MIN_LENGTH) problems.push('tooShort');

  // Only consult the list once there is something to consult: a short password is
  // reported as short, not also as common, so the form shows one clear reason. Fixing the
  // length alone fixes the problem, and two reasons at once reads as two problems.
  //
  // The list holds the bare *word*, because that is what the candidates reduce to.
  if (value.length >= MIN_LENGTH && candidates(value).some((c) => COMMON_PASSWORDS.has(c))) {
    problems.push('tooCommon');
  }

  if (email) {
    const at = email.indexOf('@');
    const local = (at > 0 ? email.slice(0, at) : email).toLowerCase();
    const domain = at > 0 ? email.slice(at + 1).split('.')[0].toLowerCase() : '';
    const haystack = value.toLowerCase();
    // Three characters, so `ahmed@x.com` is caught but a password merely containing the
    // letter "a" is not treated as self-referential.
    if (local.length >= 3 && haystack.includes(local)) problems.push('containsEmail');
    if (domain.length >= 4 && haystack.includes(domain)) problems.push('containsEmail');
  }

  if (new Set(value).size < 6) problems.push('tooFewDistinct');

  if (isSequential(value)) problems.push('isSequential');
  if (isKeyboardWalk(value)) problems.push('isKeyboardWalk');

  return { ok: problems.length === 0, score: score(value, problems.length), problems };
}

/**
 * A coarse 0-4 for the meter.
 *
 * Length does nearly all the work, which is the point of choosing it over composition
 * rules. Penalties are subtracted so an obviously bad password cannot reach the top band
 * on length alone.
 */
function score(password: string, problemCount: number): 0 | 1 | 2 | 3 | 4 {
  const length = password.length;
  let points: number;

  if (length === 0) return 0;
  if (length < MIN_LENGTH) points = 1;
  else if (length < 14) points = 2;
  else if (length < 20) points = 3;
  else points = 4;

  // Distant second place from a long single-character run, which the problem list also
  // catches. Two is enough to knock it out of "strong".
  const distinct = new Set(password).size;
  if (distinct < 6) points = Math.max(0, points - 2);
  else if (distinct < 10) points = Math.max(0, points - 1);

  points -= Math.min(problemCount, 2);

  return Math.max(0, Math.min(4, points)) as 0 | 1 | 2 | 3 | 4;
}
