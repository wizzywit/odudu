import { describe, expect, it } from 'vitest';
import { relayFailure } from '#/service/smtp-failure';

function coded(code: string | undefined, responseCode?: number): Error {
  return Object.assign(new Error('220 relay.example banner: secret-text'), {
    ...(code === undefined ? {} : { code }),
    ...(responseCode === undefined ? {} : { responseCode }),
  });
}

describe('relayFailure', () => {
  it.each([
    ['ECONNECTION', undefined, 'connection'],
    ['ETIMEDOUT', undefined, 'connection'],
    ['ESOCKET', undefined, 'connection'],
    ['ETLS', undefined, 'tls'],
    ['EAUTH', 535, 'auth'],
    ['EENVELOPE', 550, 'rejected'],
    ['EMESSAGE', 554, 'rejected'],
    [undefined, 451, 'rejected'],
    [undefined, undefined, 'other'],
    ['SOMETHING', undefined, 'other'],
  ] as const)('classes code %s / response %s as %s', (code, responseCode, expected) => {
    expect(relayFailure(coded(code, responseCode)).kind).toBe(expected);
  });

  it('says one fixed sentence per class, never the relay’s own text', () => {
    for (const error of [coded('EAUTH', 535), coded('ECONNECTION'), 'plain string', null]) {
      expect(relayFailure(error).detail).not.toMatch(/secret-text|banner/u);
    }
    expect(relayFailure(coded('EAUTH', 535)).detail).toBe(relayFailure(coded('EAUTH')).detail);
  });
});
