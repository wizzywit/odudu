import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateClientKey, loadClientKey } from '#/service/client-key';

describe('the service account key', () => {
  it('is the base64 of a private EC P-256 JWK that loads back', () => {
    const text = generateClientKey();
    const jwk = JSON.parse(Buffer.from(text, 'base64').toString('utf8')) as Record<string, unknown>;
    expect(jwk).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' });
    const key = loadClientKey(text);
    expect(key.privateJwk.d).toBe(jwk.d);
    expect(key.publicJwk).not.toHaveProperty('d');
  });

  it('takes its kid from the RFC 7638 thumbprint, whatever the value says', () => {
    const text = generateClientKey();
    const jwk = JSON.parse(Buffer.from(text, 'base64').toString('utf8')) as Record<string, string>;
    const forged = Buffer.from(JSON.stringify({ ...jwk, kid: 'forged' })).toString('base64');
    const expected = createHash('sha256')
      .update(`{"crv":"P-256","kty":"EC","x":"${jwk.x ?? ''}","y":"${jwk.y ?? ''}"}`)
      .digest('base64url');
    expect(loadClientKey(forged).kid).toBe(expected);
  });

  it.each([
    ['not base64 JSON', 'SECRET'],
    ['a JSON array', Buffer.from('[]').toString('base64')],
    ['another curve', Buffer.from(JSON.stringify({ kty: 'EC', crv: 'P-384' })).toString('base64')],
    [
      'a public key',
      (() => {
        const jwk = JSON.parse(Buffer.from(generateClientKey(), 'base64').toString()) as Record<
          string,
          unknown
        >;
        delete jwk.d;
        return Buffer.from(JSON.stringify(jwk)).toString('base64');
      })(),
    ],
  ])('refuses %s with mcp_key_invalid, naming no part of it', (_name, text) => {
    expect(() => loadClientKey(text)).toThrow(
      expect.objectContaining({ code: 'mcp_key_invalid' }) as Error,
    );
    try {
      loadClientKey(text);
    } catch (error) {
      expect(String(error)).not.toContain('SECRET');
    }
  });
});
