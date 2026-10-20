import { describe, expect, it } from 'vitest';

import { assessPassword, MIN_LENGTH } from './password';

/**
 * The password policy is the only thing standing between a signup form and `qwerty123`
 * on the Free plan, where Supabase's leaked-password check is unavailable. A bug in here
 * is a bug nobody notices, because the failure mode is a weak password that looks fine.
 *
 * So the assertions are mostly about what must be *rejected*, and about the normalisations
 * that make the blocklist actually work -- a blocklist that only catches the exact literal
 * is worse than none, because it looks like protection.
 */
describe('assessPassword', () => {
  it('rejects anything shorter than the floor', () => {
    expect(assessPassword('a'.repeat(MIN_LENGTH - 1)).problems).toContain('tooShort');
    expect(assessPassword('a'.repeat(MIN_LENGTH)).problems).not.toContain('tooShort');
  });

  it('accepts a long, varied, non-sequential password', () => {
    const verdict = assessPassword('correct-horse-battery-staple-7');
    expect(verdict.ok).toBe(true);
    expect(verdict.problems).toEqual([]);
  });

  describe('the common-password blocklist', () => {
    it.each([
      // 12 characters or more: the policy reports a short password only as short, so a
      // shorter fixture would be testing the length rule, not the blocklist.
      'password1234',
      'Password1234',
      'PASSWORD1234',
      'p@ssw0rd1234',
      'p4ssword1234',
      'Pa$$w0rd1234',
      'password.1234',
      'qwerty123456',
      'letmein12345',
      'welcome123456',
      // The case the first implementation got wrong: its leet chain rewrote the trailing
      // digits, so this normalised to `passwordgtea` and passed as acceptable.
      'Password1!234',
    ])('rejects %s despite its disguise', (candidate) => {
      expect(assessPassword(candidate).problems).toContain('tooCommon');
    });

    it('catches the leet substitutions a person actually types', () => {
      // Individually these are the substitutions every blocklist claims to handle.
      expect(assessPassword('p4ssw0rd').ok).toBe(false);
      expect(assessPassword('adm1n12345').ok).toBe(false);
    });

    it('reports a short password as short rather than as common', () => {
      // `password` is on the list and is also too short. Naming both would make the form
      // show two reasons when fixing the length alone would fix the problem.
      expect(assessPassword('password').problems).toEqual(['tooShort']);
    });

    it('does not reject the product name, or the seeded demo password', () => {
      // Both were in the blocklist at one point and both were removed.
      //
      // `Bershama#2026` is the seeded demo credential. If the policy rejected it, the demo
      // accounts would be locked out of their own data -- the single most important
      // non-rejection in this file.
      //
      // `bershama` is this product's name. Blocking it punishes anyone who legitimately
      // picks it for a reason we cannot see, and the list's job is to catch what appears in
      // breach corpora, which this does not. GoTrue's minimum length is the control that
      // does not have to make that judgement call.
      //
      // The bare name is padded to clear the twelve-character minimum, because a
      // shorter one would be rejected for its length and the assertion would pass for
      // the wrong reason -- it would be testing the length rule and calling it a
      // blocklist result. `pharmaflow26` was twelve characters by accident; the
      // replacement is padded on purpose.
      expect(assessPassword('Bershama#2026').ok).toBe(true);
      expect(assessPassword('bershama2026').ok).toBe(true);
    });
  });

  describe('structure', () => {
    it('rejects a long run of one repeated character', () => {
      expect(assessPassword('aaaaaaaaaaaaaa').problems).toContain('tooFewDistinct');
    });

    it('rejects an alphabet or digit run', () => {
      expect(assessPassword('abcdefghijklmno').problems).toContain('isSequential');
      expect(assessPassword('98765432109876').problems).toContain('isSequential');
    });

    it('rejects a keyboard walk, which no character-code check can see', () => {
      // q is 113 and w is 119: there is no arithmetic run anywhere in this string, so a
      // purely code-based check passes it. It is also one of the most guessed strings in
      // existence, and its length and character variety both look respectable.
      expect(assessPassword('qwertyuiopasdfg').problems).toContain('isKeyboardWalk');
      expect(assessPassword('asdfghjkl;zxcv').ok).toBe(false);
      expect(assessPassword('7890123456789').ok).toBe(false);
    });

    it('tolerates a short run inside an otherwise good password', () => {
      // `correct-horse-battery-staple-7` contains "rst" and must not be punished for it.
      // Otherwise the rule trains people away from ordinary words.
      expect(assessPassword('correct-horse-battery-staple-7').problems).not.toContain(
        'isSequential',
      );
    });

    it('does not credit length alone when the password is obviously poor', () => {
      const long = 'aaaaaaaaaaaaaaa';
      const good = 'correct-horse-battery-staple-7';
      expect(assessPassword(long).score).toBeLessThan(assessPassword(good).score);
    });
  });

  describe('self-reference', () => {
    it('rejects a password built from the user\'s own email', () => {
      const verdict = assessPassword('ahmed.hassan.99', 'ahmed.hassan@bershama.com');
      expect(verdict.problems).toContain('containsEmail');
    });

    it('rejects one built from the email domain', () => {
      expect(assessPassword('bershama-2026-x', 'ahmed@bershama.com').problems).toContain(
        'containsEmail',
      );
    });

    it('does not fire on a two-letter local part', () => {
      // Otherwise an address like `ab@x.com` would forbid the substring "ab" everywhere,
      // which is absurd.
      expect(
        assessPassword('wonderful-battery-ab-99', 'ab@x.com').problems,
      ).not.toContain('containsEmail');
    });

    it('is not evaluated at all when no email is supplied', () => {
      expect(assessPassword('correct-horse-battery-staple-7').problems).toEqual([]);
    });
  });

  describe('the score', () => {
    it('stays inside 0-4 for every input', () => {
      for (const candidate of ['', 'a', 'abcdefghijkl', 'correct-horse-battery-staple-7']) {
        const { score } = assessPassword(candidate);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(4);
      }
    });

    it('rises with length', () => {
      const short = assessPassword('quiet-rain-44').score;
      const longer = assessPassword('quiet-rain-44-then-some-more').score;
      expect(longer).toBeGreaterThan(short);
    });

    it('handles an empty string without throwing', () => {
      expect(assessPassword('')).toEqual({ ok: false, score: 0, problems: ['tooShort', 'tooFewDistinct'] });
    });
  });
});
