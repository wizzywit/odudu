import { describe, expect, it } from 'vitest';
import { unfinishableActions } from '#/service/owed-actions';

describe('unfinishableActions', () => {
  it('drops nothing when nothing that decides is known', () => {
    expect(unfinishableActions(['verify-email', 'accept-terms', 'update-profile'], {})).toEqual([]);
  });

  it('drops verify-email for an address already proved, and for none at all', () => {
    expect(
      unfinishableActions(['verify-email'], { address: { present: true, verified: true } }),
    ).toEqual(['verify-email']);
    expect(
      unfinishableActions(['verify-email'], { address: { present: false, verified: false } }),
    ).toEqual(['verify-email']);
    expect(
      unfinishableActions(['verify-email'], { address: { present: true, verified: false } }),
    ).toEqual([]);
  });

  it('drops accept-terms where there are no terms, or this version was accepted', () => {
    expect(
      unfinishableActions(['accept-terms'], { terms: { configured: false, accepted: false } }),
    ).toEqual(['accept-terms']);
    expect(
      unfinishableActions(['accept-terms'], { terms: { configured: true, accepted: true } }),
    ).toEqual(['accept-terms']);
    expect(
      unfinishableActions(['accept-terms'], { terms: { configured: true, accepted: false } }),
    ).toEqual([]);
  });

  it('drops generate-recovery-codes for somebody who holds no TOTP', () => {
    expect(
      unfinishableActions(['generate-recovery-codes'], { recovery: { holdsTotp: false } }),
    ).toEqual(['generate-recovery-codes']);
    expect(
      unfinishableActions(['generate-recovery-codes'], { recovery: { holdsTotp: true } }),
    ).toEqual([]);
  });

  it('names only what is owed, and leaves update-profile for the person to do', () => {
    expect(
      unfinishableActions(['update-profile', 'configure-totp'], {
        address: { present: true, verified: true },
        terms: { configured: false, accepted: false },
      }),
    ).toEqual([]);
  });
});
