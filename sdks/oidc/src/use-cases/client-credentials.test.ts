import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OduduError } from '#/services/odudu-error';
import { startFakeServer, type FakeServer } from '#/testing/fake-server';
import { testKey, verifyAssertion, type TestKey } from '#/testing/client-keys';
import { clientCredentials } from '#/use-cases/client-credentials';
import type { ClientCredentialsOptions } from '#/types';

const NOW = 1_800_000_000_000;
const deps = { allowInsecureRequests: true, now: () => NOW };
let fake: FakeServer;

beforeEach(async () => {
  fake = await startFakeServer();
});
afterEach(async () => {
  await fake.close();
});

function formEncode(value: string): string {
  return new URLSearchParams({ v: value }).toString().slice(2);
}

function keyOptions(
  key: TestKey,
  extra: { kid?: string; alg?: string } = {},
): ClientCredentialsOptions {
  return {
    issuer: fake.issuer,
    clientId: 'service-1',
    auth: { privateKey: key.privateKey, ...extra },
  };
}

async function refusal(options: ClientCredentialsOptions): Promise<OduduError> {
  const error = await clientCredentials(options, deps).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(OduduError);
  return error as OduduError;
}

describe('clientCredentials with a secret', () => {
  it('sends client_secret_basic with the id and secret form-encoded then base64', async () => {
    const secret = 'se:cr et/+%';
    await clientCredentials(
      { issuer: fake.issuer, clientId: 'my service', auth: { secret }, scope: 'reports:read' },
      deps,
    );
    const expected = Buffer.from(`${formEncode('my service')}:${formEncode(secret)}`).toString(
      'base64',
    );
    expect(fake.tokenAuthorizations).toEqual([`Basic ${expected}`]);
    const form = fake.tokenRequests[0];
    expect(form?.get('grant_type')).toBe('client_credentials');
    expect(form?.get('scope')).toBe('reports:read');
    expect(form?.has('client_secret')).toBe(false);
    expect(form?.has('client_assertion')).toBe(false);
  });

  it('returns the access token, its expiry and its scope', async () => {
    fake.expiresIn = 600;
    fake.scope = 'reports:read';
    const token = await clientCredentials(
      { issuer: fake.issuer, clientId: 'service-1', auth: { secret: 's' }, scope: 'reports:read' },
      deps,
    );
    expect(token).toEqual({
      accessToken: 'client-token-1',
      expiresAt: NOW + 600_000,
      scope: 'reports:read',
    });
  });

  it('falls back to the requested scope when the response names none', async () => {
    fake.scope = undefined;
    const token = await clientCredentials(
      { issuer: fake.issuer, clientId: 'service-1', auth: { secret: 's' }, scope: 'a b' },
      deps,
    );
    expect(token.scope).toBe('a b');
  });

  it('treats a response without expires_in as a 60 s token', async () => {
    fake.expiresIn = undefined;
    const token = await clientCredentials(
      { issuer: fake.issuer, clientId: 'c', auth: { secret: 's' } },
      deps,
    );
    expect(token.expiresAt).toBe(NOW + 60_000);
  });

  it('sends the resource when given and omits scope and resource otherwise', async () => {
    await clientCredentials(
      {
        issuer: fake.issuer,
        clientId: 'c',
        auth: { secret: 's' },
        resource: 'https://api.example/x',
      },
      deps,
    );
    await clientCredentials({ issuer: fake.issuer, clientId: 'c', auth: { secret: 's' } }, deps);
    expect(fake.tokenRequests[0]?.getAll('resource')).toEqual(['https://api.example/x']);
    expect(fake.tokenRequests[1]?.has('resource')).toBe(false);
    expect(fake.tokenRequests[1]?.has('scope')).toBe(false);
  });

  it('rejects with an OduduError carrying the error the server sent', async () => {
    fake.tokenError = { error: 'invalid_client', error_description: 'unknown client' };
    const error = await refusal({ issuer: fake.issuer, clientId: 'c', auth: { secret: 'bad' } });
    expect(error.code).toBe('invalid_client');
    expect(error.error).toBe('invalid_client');
    expect(error.errorDescription).toBe('unknown client');
  });

  it('rejects a secret and a private key together as invalid_options', async () => {
    const key = await testKey('ES256');
    const both = {
      secret: 's',
      privateKey: key.privateKey,
    } as unknown as ClientCredentialsOptions['auth'];
    const error = await refusal({ issuer: fake.issuer, clientId: 'c', auth: both });
    expect(error.code).toBe('invalid_options');
    expect(fake.tokenRequests).toHaveLength(0);
  });

  it('rejects an empty secret as invalid_options before any request', async () => {
    const error = await refusal({ issuer: fake.issuer, clientId: 'c', auth: { secret: '' } });
    expect(error.code).toBe('invalid_options');
    expect(fake.tokenRequests).toHaveLength(0);
  });
});

describe('clientCredentials with a private key', () => {
  const cases = [
    { alg: 'ES256', expected: 'ES256' },
    { alg: 'RS256', expected: 'RS256' },
  ];
  for (const { alg, expected } of cases) {
    it(`signs a private_key_jwt assertion with ${alg} for the token endpoint`, async () => {
      const key = await testKey(alg);
      await clientCredentials(keyOptions(key, { kid: 'key-1' }), deps);
      const form = fake.tokenRequests[0];
      expect(form?.get('client_assertion_type')).toBe(
        'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      );
      expect(form?.get('client_id')).toBe('service-1');
      expect(fake.tokenAuthorizations[0]).toBeUndefined();
      const { header, payload } = await verifyAssertion(
        form?.get('client_assertion') ?? '',
        key.publicKey,
        { clientId: 'service-1', audience: `${fake.issuer}/token`, now: NOW },
        expected,
      );
      expect(header).toMatchObject({ alg: expected, kid: 'key-1' });
      expect(payload.iss).toBe('service-1');
      expect(payload.sub).toBe('service-1');
      expect(payload.aud).toBe(`${fake.issuer}/token`);
      expect(payload.exp).toBeGreaterThan(NOW / 1000);
      expect(payload.exp).toBe(NOW / 1000 + 120);
    });
  }

  it('uses the alg given over the one the key type suggests', async () => {
    const key = await testKey('PS256');
    await clientCredentials(keyOptions(key, { alg: 'PS256' }), deps);
    const { header } = await verifyAssertion(
      fake.tokenRequests[0]?.get('client_assertion') ?? '',
      key.publicKey,
      { clientId: 'service-1', audience: `${fake.issuer}/token`, now: NOW },
      'PS256',
    );
    expect(header.alg).toBe('PS256');
  });

  it('gives every assertion its own jti', async () => {
    const key = await testKey('ES256');
    await clientCredentials(keyOptions(key), deps);
    await clientCredentials(keyOptions(key), deps);
    const jtis = await Promise.all(
      fake.tokenRequests.map(
        async (form) =>
          (
            await verifyAssertion(
              form.get('client_assertion') ?? '',
              key.publicKey,
              { clientId: 'service-1', audience: `${fake.issuer}/token`, now: NOW },
              'ES256',
            )
          ).payload.jti,
      ),
    );
    expect(new Set(jtis).size).toBe(2);
    expect(jtis[0]).toBeTruthy();
  });

  it('sends the resource when given', async () => {
    const key = await testKey('ES256');
    await clientCredentials({ ...keyOptions(key), resource: 'https://api.example/x' }, deps);
    expect(fake.tokenRequests[0]?.getAll('resource')).toEqual(['https://api.example/x']);
  });

  it('rejects a key it cannot sign with as invalid_options', async () => {
    const error = await refusal({
      issuer: fake.issuer,
      clientId: 'c',
      auth: { privateKey: { kty: 'oct', k: 'AAAA' } },
    });
    expect(error.code).toBe('invalid_options');
    expect(fake.tokenRequests).toHaveLength(0);
  });

  it('rejects with the server error when the assertion is refused', async () => {
    fake.tokenError = { error: 'invalid_client' };
    const error = await refusal(keyOptions(await testKey('ES256')));
    expect(error.code).toBe('invalid_client');
  });
});
