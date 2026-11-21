import { describe, expect, it } from 'vitest';
import { OduduError } from '#/services/odudu-error';
import { testKey, verifyAssertion } from '#/testing/client-keys';
import { signClientAssertion } from '#/use-cases/sign-client-assertion';

const NOW = 1_800_000_000_000;
const ENDPOINT = 'https://id.example.com/tenants/acme/protocol/openid-connect/token';

describe('signClientAssertion', () => {
  it('signs the private_key_jwt assertion for a token endpoint, as the server verifies it', async () => {
    const key = await testKey('ES256');
    const assertion = await signClientAssertion({
      clientId: 'svc',
      audience: ENDPOINT,
      privateKey: key.privateKey,
      kid: 'k1',
      now: NOW,
    });
    const verified = await verifyAssertion(
      assertion,
      key.publicKey,
      { clientId: 'svc', audience: ENDPOINT, now: NOW },
      'ES256',
    );
    expect(verified.header).toEqual({ alg: 'ES256', kid: 'k1' });
    expect(verified.payload).toMatchObject({
      iss: 'svc',
      sub: 'svc',
      aud: ENDPOINT,
      iat: NOW / 1000,
      exp: NOW / 1000 + 120,
    });
    expect(typeof verified.payload.jti).toBe('string');
  });

  it('gives every assertion its own jti', async () => {
    const key = await testKey('ES256');
    const input = { clientId: 'svc', audience: ENDPOINT, privateKey: key.privateKey, now: NOW };
    const [a, b] = await Promise.all([signClientAssertion(input), signClientAssertion(input)]);
    const jti = (token: string) =>
      (
        JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as {
          jti: string;
        }
      ).jti;
    expect(jti(a)).not.toBe(jti(b));
  });

  it('refuses an empty client id, and a key that cannot sign, with invalid_options', async () => {
    const key = await testKey('ES256');
    const empty = await signClientAssertion({
      clientId: '',
      audience: ENDPOINT,
      privateKey: key.privateKey,
    }).catch((e: unknown) => e);
    expect(empty).toBeInstanceOf(OduduError);
    expect((empty as OduduError).code).toBe('invalid_options');
    const broken = await signClientAssertion({
      clientId: 'svc',
      audience: ENDPOINT,
      privateKey: { kty: 'EC', crv: 'P-256' },
    }).catch((e: unknown) => e);
    expect((broken as OduduError).code).toBe('invalid_options');
  });
});
