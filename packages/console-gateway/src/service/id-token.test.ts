import { describe, expect, it } from 'vitest';
import { subjectOfIdToken } from '#/service/id-token';

const NOW = new Date('2026-06-01T12:00:00.000Z');
const SECONDS = Math.floor(NOW.getTime() / 1000);
const SUB = '01a0e612-ee9f-7fe5-aa03-3cd1476237da';
const EXPECTED = { nonce: 'n-0S6_WzA2Mj', clientId: 'odudu-admin', now: NOW };

function claims(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { sub: SUB, nonce: 'n-0S6_WzA2Mj', aud: 'odudu-admin', iat: SECONDS, ...extra };
}

describe('subjectOfIdToken', () => {
  it('answers the subject of claims that match the login', () => {
    expect(subjectOfIdToken(claims(), EXPECTED)).toBe(SUB);
  });

  it.each([
    ['a different nonce', { nonce: 'other' }],
    ['no nonce', { nonce: undefined }],
    ['a subject that is not a UUID', { sub: 'ada' }],
    ['no subject', { sub: undefined }],
    ['an azp naming another client', { azp: 'billing' }],
    ['several audiences and no azp', { aud: ['odudu-admin', 'billing'] }],
    ['several audiences and another azp', { aud: ['odudu-admin', 'billing'], azp: 'billing' }],
    ['an iat more than a minute ahead', { iat: SECONDS + 61 }],
    ['an iat that is not a number', { iat: 'soon' }],
  ])('refuses %s', (_label, extra) => {
    expect(subjectOfIdToken(claims(extra), EXPECTED)).toBeNull();
  });

  it('accepts several audiences when azp names the client, and an iat within the skew', () => {
    expect(
      subjectOfIdToken(
        claims({ aud: ['odudu-admin', 'billing'], azp: 'odudu-admin', iat: SECONDS + 60 }),
        EXPECTED,
      ),
    ).toBe(SUB);
  });
});
