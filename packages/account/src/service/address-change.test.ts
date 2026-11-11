import { describe, expect, it } from 'vitest';
import { mayTakeAddress } from '#/service/address-change';

describe('mayTakeAddress', () => {
  it('lets an address nobody holds be taken', () => {
    expect(mayTakeAddress(null, 'me')).toBe(true);
  });

  it('lets a subject take an address it holds itself, in another case', () => {
    expect(mayTakeAddress('me', 'me')).toBe(true);
  });

  it('refuses an address another account holds', () => {
    expect(mayTakeAddress('other', 'me')).toBe(false);
  });
});
