import { describe, expect, it } from 'vitest';
import { ownVerificationVerdict } from '#/service/own-verification';

const READY = { verified: false, hasEmail: true, mailAvailable: true };

describe('ownVerificationVerdict', () => {
  it('sends a link to an address that is not proved, when mail can be sent', () => {
    expect(ownVerificationVerdict(READY, () => true)).toBe('send');
  });

  it('has nothing to send to an address already proved', () => {
    expect(ownVerificationVerdict({ ...READY, verified: true }, () => true)).toBe('verified');
  });

  it('cannot send to no address, or where no mail goes out', () => {
    expect(ownVerificationVerdict({ ...READY, hasEmail: false }, () => true)).toBe('unavailable');
    expect(ownVerificationVerdict({ ...READY, mailAvailable: false }, () => true)).toBe(
      'unavailable',
    );
  });

  it('spends one mail of the address’s budget only when it would send', () => {
    let spent = 0;
    const budget = (): boolean => {
      spent += 1;
      return true;
    };
    ownVerificationVerdict({ ...READY, verified: true }, budget);
    ownVerificationVerdict({ ...READY, hasEmail: false }, budget);
    ownVerificationVerdict({ ...READY, mailAvailable: false }, budget);
    expect(spent).toBe(0);
    ownVerificationVerdict(READY, budget);
    expect(spent).toBe(1);
  });

  it('holds a link back when the address has had its share', () => {
    expect(ownVerificationVerdict(READY, () => false)).toBe('limited');
  });
});
