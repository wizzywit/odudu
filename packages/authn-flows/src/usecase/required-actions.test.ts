import { describe, expect, it } from 'vitest';
import { type RequiredAction } from '#/schema/required-action';
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

  it('runs every action in the fixed order', () => {
    const order: RequiredAction[] = [
      'verify-email',
      'update-password',
      'configure-totp',
      'configure-passkey',
      'generate-recovery-codes',
      'update-profile',
      'accept-terms',
    ];
    const owed = [...order].reverse();
    const walked: RequiredAction[] = [];
    for (let left = owed; left.length > 0;) {
      const next = nextRequiredAction(left);
      if (next === null) break;
      walked.push(next);
      left = left.filter((action) => action !== next);
    }
    expect(walked).toEqual(order);
  });

  it('proves an address before anything else, and asks for the profile and terms last', () => {
    expect(nextRequiredAction(['update-password', 'verify-email'])).toBe('verify-email');
    expect(nextRequiredAction(['accept-terms', 'update-profile'])).toBe('update-profile');
    expect(nextRequiredAction(['accept-terms', 'generate-recovery-codes'])).toBe(
      'generate-recovery-codes',
    );
  });

  it('ignores a duplicate entry rather than treating it specially', () => {
    expect(nextRequiredAction(['configure-totp', 'configure-totp'])).toBe('configure-totp');
  });
});
