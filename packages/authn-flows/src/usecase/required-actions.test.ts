import { describe, expect, it } from 'vitest';
import { nextRequiredAction } from '#/usecase/required-actions';

describe('nextRequiredAction', () => {
  it('returns null when nothing is pending', () => {
    expect(nextRequiredAction([])).toBeNull();
  });

  it('returns the one pending action', () => {
    expect(nextRequiredAction(['configure-totp'])).toBe('configure-totp');
  });

  // The fixed order's whole point: whichever order the two were added in,
  // the same one always runs first.
  it('always runs update-password before configure-totp, regardless of input order', () => {
    expect(nextRequiredAction(['configure-totp', 'update-password'])).toBe('update-password');
    expect(nextRequiredAction(['update-password', 'configure-totp'])).toBe('update-password');
  });

  it('runs every action in the fixed order: update-password, configure-totp, configure-passkey, generate-recovery-codes', () => {
    const all: (
      'update-password' | 'configure-totp' | 'configure-passkey' | 'generate-recovery-codes'
    )[] = ['generate-recovery-codes', 'configure-passkey', 'configure-totp', 'update-password'];
    expect(nextRequiredAction(all)).toBe('update-password');
    expect(nextRequiredAction(all.filter((action) => action !== 'update-password'))).toBe(
      'configure-totp',
    );
    expect(
      nextRequiredAction(
        all.filter((action) => !['update-password', 'configure-totp'].includes(action)),
      ),
    ).toBe('configure-passkey');
    expect(nextRequiredAction(['generate-recovery-codes'])).toBe('generate-recovery-codes');
  });

  it('ignores a duplicate entry rather than treating it specially', () => {
    expect(nextRequiredAction(['configure-totp', 'configure-totp'])).toBe('configure-totp');
  });
});
