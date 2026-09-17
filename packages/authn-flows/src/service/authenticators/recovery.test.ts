import { hashPassword } from '@odudu/domain-identity';
import { describe, expect, it } from 'vitest';
import {
  generateRecoveryCodes,
  normaliseRecoveryCode,
  recoveryApplicable,
  recoveryCodeOffered,
  recoveryStep,
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_COUNT,
  type StoredRecoveryCode,
} from '#/service/authenticators/recovery';

const SUBJECT = '11111111-1111-1111-1111-111111111111';

async function stored(code: string, usedAt?: string): Promise<StoredRecoveryCode> {
  const hash = await hashPassword(normaliseRecoveryCode(code));
  return {
    id: `credential-${code}`,
    secret: { kind: 'recovery-code', hash, ...(usedAt === undefined ? {} : { usedAt }) },
  };
}

describe('generateRecoveryCodes', () => {
  it('issues ten codes by default', () => {
    expect(generateRecoveryCodes()).toHaveLength(RECOVERY_CODE_COUNT);
    expect(generateRecoveryCodes(3)).toHaveLength(3);
  });

  it('issues distinct codes', () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(codes.length);
  });

  // The whole of the entropy claim, asserted rather than described: ten
  // characters drawn from a 32-character alphabet is 32^10, which is 2^50.
  it('draws ten characters from the 32-character alphabet, printed in two groups of five', () => {
    expect(RECOVERY_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(RECOVERY_CODE_ALPHABET).size).toBe(32);
    for (const code of generateRecoveryCodes()) {
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/u);
      expect(normaliseRecoveryCode(code)).toHaveLength(10);
    }
  });

  it('excludes the characters a reader confuses, folding them onto the digits instead', () => {
    for (const excluded of ['I', 'L', 'O', 'U']) {
      expect(RECOVERY_CODE_ALPHABET).not.toContain(excluded);
    }
    expect(normaliseRecoveryCode('o5hq1-ilABC')).toBe('05HQ111ABC');
  });

  it('accepts a code back with or without the separator it was printed with', () => {
    const [code] = generateRecoveryCodes(1);
    expect(code).toBeDefined();
    const plain = normaliseRecoveryCode(code ?? '');
    expect(normaliseRecoveryCode(` ${plain.toLowerCase()} `)).toBe(plain);
  });
});

describe('recoveryStep', () => {
  it('succeeds on a code the subject holds, naming the row to spend', async () => {
    const good = await stored('ABCDE-FGHJK');
    const other = await stored('MNPQR-STVWX');

    const result = await recoveryStep(
      { recoveryCode: 'abcde-fghjk' },
      { subjectId: SUBJECT, codes: [other, good] },
    );

    expect(result).toEqual({ kind: 'success', subjectId: SUBJECT, credentialId: good.id });
  });

  it('fails on a code the subject does not hold', async () => {
    const result = await recoveryStep(
      { recoveryCode: 'ZZZZZ-ZZZZZ' },
      { subjectId: SUBJECT, codes: [await stored('ABCDE-FGHJK')] },
    );

    expect(result).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });

  // A spent code is refused as spent, not as unknown: the attempt is
  // already bound to this subject, so the answer is about their own
  // credential and tells them to try the next one rather than to give up on
  // the list.
  it('refuses a code that has already been spent, and says so', async () => {
    const result = await recoveryStep(
      { recoveryCode: 'ABCDE-FGHJK' },
      { subjectId: SUBJECT, codes: [await stored('ABCDE-FGHJK', '2026-09-16T12:00:00.000Z')] },
    );

    expect(result).toEqual({ kind: 'failure', reason: 'already_used' });
  });

  it('challenges when nothing was submitted', async () => {
    expect(await recoveryStep({}, { subjectId: SUBJECT, codes: [] })).toEqual({
      kind: 'challenge',
      form: 'recovery-code',
    });
    expect(
      await recoveryStep({ recoveryCode: '  -  ' }, { subjectId: SUBJECT, codes: [] }),
    ).toEqual({ kind: 'challenge', form: 'recovery-code' });
  });

  it('fails when the caller resolved no subject', async () => {
    const result = await recoveryStep(
      { recoveryCode: 'ABCDE-FGHJK' },
      { subjectId: null, codes: [await stored('ABCDE-FGHJK')] },
    );

    expect(result).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });

  it('fails rather than succeeding when the subject holds no codes at all', async () => {
    expect(
      await recoveryStep({ recoveryCode: 'ABCDE-FGHJK' }, { subjectId: SUBJECT, codes: [] }),
    ).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });
});

describe('recoveryCodeOffered', () => {
  it('is offered only by a submission carrying something from the alphabet', () => {
    expect(recoveryCodeOffered({})).toBe(false);
    expect(recoveryCodeOffered({ recoveryCode: '' })).toBe(false);
    expect(recoveryCodeOffered({ recoveryCode: '---' })).toBe(false);
    expect(recoveryCodeOffered({ recoveryCode: 'ABCDE-FGHJK' })).toBe(true);
  });
});

describe('recoveryApplicable', () => {
  const NOTHING_SATISFIED: ReadonlySet<string> = new Set();
  const AFTER_A_PASSKEY: ReadonlySet<string> = new Set(['passkey']);

  it('applies to a submission that carries a code, from a subject who has some', () => {
    expect(recoveryApplicable({ hasRecoveryCodes: true }, true, true, NOTHING_SATISFIED)).toBe(
      true,
    );
  });

  it('stands aside when nothing was offered, so the factor it replaces runs instead', () => {
    expect(recoveryApplicable({ hasRecoveryCodes: true }, false, true, NOTHING_SATISFIED)).toBe(
      false,
    );
  });

  it('does not apply to a subject with no codes, nor where no second factor is in play', () => {
    expect(recoveryApplicable({ hasRecoveryCodes: false }, true, true, NOTHING_SATISFIED)).toBe(
      false,
    );
    expect(recoveryApplicable({ hasRecoveryCodes: true }, true, false, NOTHING_SATISFIED)).toBe(
      false,
    );
  });

  it('does not apply after a passkey, which is already two factors', () => {
    expect(recoveryApplicable({ hasRecoveryCodes: true }, true, true, AFTER_A_PASSKEY)).toBe(false);
  });
});
