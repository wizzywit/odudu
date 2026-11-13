import { describe, expect, it } from 'vitest';
import { type AuthenticationSessionRecord } from '#/schema/authentication-sessions';
import { offeredTotp, totpOfferOf } from '#/service/totp-offer';

const PARAMETERS = { algorithm: 'SHA256', digits: 8, period: 60 } as const;

function recordWith(totpOffer: unknown): AuthenticationSessionRecord {
  return { pendingRequest: { totpOffers: totpOffer } } as unknown as AuthenticationSessionRecord;
}

describe('the TOTP offer a sign-in remembers', () => {
  it('hands back the parameters for the secret it was made for, and for no other', () => {
    const offer = totpOfferOf('SECRET-A', PARAMETERS);
    expect(offeredTotp(recordWith([offer]), 'SECRET-A')).toEqual(PARAMETERS);
    expect(offeredTotp(recordWith([offer]), 'SECRET-B')).toBeNull();
  });

  it('keeps the secret itself out of what is stored', () => {
    expect(JSON.stringify(totpOfferOf('SECRET-A', PARAMETERS))).not.toContain('SECRET-A');
  });

  it('reads nothing from a missing, null or malformed offer', () => {
    expect(offeredTotp(null, 'SECRET-A')).toBeNull();
    expect(offeredTotp(recordWith(undefined), 'SECRET-A')).toBeNull();
    expect(
      offeredTotp(recordWith({ secretDigest: 'x', algorithm: 'MD5', digits: 6, period: 30 }), 'x'),
    ).toBeNull();
    expect(offeredTotp(recordWith('nonsense'), 'SECRET-A')).toBeNull();
  });

  it('finds the offer of any of the secrets held, not only the last', () => {
    const record = recordWith([
      totpOfferOf('A', PARAMETERS),
      totpOfferOf('B', { ...PARAMETERS, digits: 6 }),
    ] as never);
    expect(offeredTotp(record, 'A')?.digits).toBe(8);
    expect(offeredTotp(record, 'B')?.digits).toBe(6);
  });
});
