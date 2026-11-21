import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OVERSIZE_BYTES } from '#/testing/fake-issuer';
import { createVerifier } from '#/use-cases/create-verifier';
import { KeyFetchError } from '#/services/verification-error';
import {
  type FakeIssuer,
  type TestKey,
  mintToken,
  startFakeIssuer,
  testKey,
} from '#/testing/fake-issuer';

const API = 'https://api.example.test';
const T0 = 1_800_000_000_000;

let issuer: FakeIssuer;
let first: TestKey;
let clock: number;

beforeEach(async () => {
  first = await testKey('k1');
  issuer = await startFakeIssuer([first.jwk]);
  clock = T0;
});
afterEach(async () => {
  await issuer.close();
});

const verifier = (jwksTtlMs?: number) =>
  createVerifier({
    issuers: [issuer.issuer],
    audience: API,
    clock: () => clock,
    allowInsecureIssuers: true,
    ...(jwksTtlMs === undefined ? {} : { jwksTtlMs }),
  });
const tokenFor = (key: TestKey): Promise<string> =>
  mintToken(key, issuer.issuer, API, Math.floor(T0 / 1000));

describe('reading the issuer keys', () => {
  it('finds the keys through the jwks_uri of the discovery document and keeps them', async () => {
    const verify = verifier();
    const token = await tokenFor(first);
    await verify(token);
    await verify(token);
    expect([issuer.discoveryRequests, issuer.jwksRequests]).toEqual([1, 1]);
  });

  it('reads both again once the TTL has passed', async () => {
    const verify = verifier(1_000);
    const token = await tokenFor(first);
    await verify(token);
    clock += 1_001;
    await verify(token);
    expect([issuer.discoveryRequests, issuer.jwksRequests]).toEqual([2, 2]);
  });

  it('shares one fetch between concurrent requests', async () => {
    let release: () => void = () => undefined;
    issuer.holdJwks = new Promise<void>((resolve) => {
      release = resolve;
    });
    const verify = verifier();
    const token = await tokenFor(first);
    const all = Promise.all([verify(token), verify(token), verify(token)]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    await all;
    expect(issuer.jwksRequests).toBe(1);
  });

  it('an unknown kid refetches the JWKS at most once per 10 s per issuer', async () => {
    const verify = verifier();
    await verify(await tokenFor(first));
    expect(issuer.jwksRequests).toBe(1);
    const second = await testKey('k2');
    issuer.keys = [first.jwk, second.jwk];
    const rotated = await tokenFor(second);

    clock += 9_000;
    await expect(verify(rotated)).rejects.toMatchObject({ reason: 'unknown_key' });
    expect(issuer.jwksRequests).toBe(1);

    clock += 2_000;
    await expect(verify(rotated)).resolves.toBeDefined();
    expect(issuer.jwksRequests).toBe(2);

    const stranger = await testKey('k3');
    const hostile = await tokenFor(stranger);
    clock += 1_000;
    await expect(verify(hostile)).rejects.toMatchObject({ reason: 'unknown_key' });
    expect(issuer.jwksRequests).toBe(2);
    clock += 10_000;
    await expect(verify(hostile)).rejects.toMatchObject({ reason: 'unknown_key' });
    expect(issuer.jwksRequests).toBe(3);
  });

  it('a burst of unknown-kid tokens costs one fetch', async () => {
    const verify = verifier();
    await verify(await tokenFor(first));
    clock += 11_000;
    const stranger = await tokenFor(await testKey('k9'));
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => verify(stranger)));
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(issuer.jwksRequests).toBe(2);
  });

  it('the key cache holds at most 20 keys per issuer', async () => {
    const keys = await Promise.all(Array.from({ length: 30 }, (_, i) => testKey(`k${String(i)}`)));
    issuer.keys = keys.map((k) => k.jwk);
    const verify = verifier();
    const within = keys.find((k) => k.kid === 'k19');
    const beyond = keys.find((k) => k.kid === 'k20');
    if (within === undefined || beyond === undefined) throw new Error('keys not generated');
    await expect(verify(await tokenFor(within))).resolves.toBeDefined();
    await expect(verify(await tokenFor(beyond))).rejects.toMatchObject({ reason: 'unknown_key' });
  });

  it('reports a JWKS endpoint that fails as a KeyFetchError, not a token fault', async () => {
    issuer.jwksStatus = 503;
    const verify = verifier();
    const token = await tokenFor(first);
    await expect(verify(token)).rejects.toBeInstanceOf(KeyFetchError);
    expect(issuer.jwksRequests).toBe(1);
    clock += 5_000;
    await expect(verify(token)).rejects.toBeInstanceOf(KeyFetchError);
    expect(issuer.jwksRequests).toBe(1);
    issuer.jwksStatus = 200;
    clock += 6_000;
    await expect(verify(token)).resolves.toBeDefined();
  });

  it('serves the last good keys through a failure, but never past twice the TTL', async () => {
    const verify = verifier(1_000);
    const token = await tokenFor(first);
    await verify(token);
    issuer.jwksStatus = 503;
    clock += 1_900;
    await expect(verify(token)).resolves.toBeDefined();
    clock += 99;
    await expect(verify(token)).resolves.toBeDefined();
    const requests = issuer.jwksRequests;
    clock += 2;
    await expect(verify(token)).rejects.toBeInstanceOf(KeyFetchError);
    expect(issuer.jwksRequests).toBe(requests + 1);
  });

  it('refuses a discovery document that names another issuer', async () => {
    const other = await startFakeIssuer([first.jwk]);
    const verify = createVerifier({
      issuers: [issuer.issuer],
      audience: API,
      clock: () => clock,
      allowInsecureIssuers: true,
      fetch: (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const target = `${other.issuer}${url.pathname.replace('/tenants/demo', '')}`;
        return fetch(target, init);
      },
    });
    await expect(verify(await tokenFor(first))).rejects.toBeInstanceOf(KeyFetchError);
    await other.close();
  });

  for (const path of ['jwks', 'discovery'] as const) {
    for (const declared of [true, false]) {
      it(`refuses an oversized ${path} document ${declared ? 'declared' : 'streamed'} without buffering it`, async () => {
        issuer.oversize = { path, declared };
        const verify = verifier();
        await expect(verify(await tokenFor(first))).rejects.toBeInstanceOf(KeyFetchError);
        expect(issuer.bytesWritten).toBeLessThan(OVERSIZE_BYTES / 2);
      });
    }
  }

  it('a failed unknown-kid refetch keeps known keys working', async () => {
    const verify = verifier();
    const token = await tokenFor(first);
    await verify(token);
    issuer.jwksStatus = 503;
    clock += 11_000;
    const stranger = await tokenFor(await testKey('k7'));
    await expect(verify(stranger)).rejects.toMatchObject({ reason: 'unknown_key' });
    expect(issuer.jwksRequests).toBe(2);
    await expect(verify(token)).resolves.toBeDefined();
    clock += 1_000;
    await expect(verify(stranger)).rejects.toMatchObject({ reason: 'unknown_key' });
    expect(issuer.jwksRequests).toBe(2);
  });

  it('a failed refresh after the TTL serves stale keys up to 2x the TTL then fails with KeyFetchError', async () => {
    const verify = verifier(1_000);
    const token = await tokenFor(first);
    await verify(token);
    issuer.jwksStatus = 503;
    clock += 1_001;
    await expect(verify(token)).resolves.toBeDefined();
    expect(issuer.jwksRequests).toBe(2);
    clock += 500;
    await expect(verify(token)).resolves.toBeDefined();
    expect(issuer.jwksRequests).toBe(2);
    clock += 600;
    await expect(verify(token)).rejects.toBeInstanceOf(KeyFetchError);
  });

  it('refuses a token longer than 16 KiB before reading it or fetching keys', async () => {
    const verify = verifier();
    await expect(verify('a'.repeat(16_385))).rejects.toMatchObject({
      status: 401,
      code: 'invalid_token',
    });
    expect(issuer.discoveryRequests).toBe(0);
  });
});

describe('the jwks_uri of the discovery document', () => {
  const secureIssuer = 'https://id.example.test/tenants/demo';
  const discovery = (jwksUri: string, calls: string[]) =>
    ((url: string) => {
      calls.push(url);
      return Promise.resolve(
        url.endsWith('/.well-known/openid-configuration')
          ? Response.json({ issuer: secureIssuer, jwks_uri: jwksUri })
          : Response.json({ keys: [first.jwk] }),
      );
    }) as typeof fetch;

  it('is refused as a KeyFetchError when it is http for an https issuer', async () => {
    const calls: string[] = [];
    const verify = createVerifier({
      issuers: [secureIssuer],
      audience: API,
      clock: () => clock,
      fetch: discovery('http://id.example.test/jwks', calls),
    });
    const token = await mintToken(first, secureIssuer, API, Math.floor(T0 / 1000));
    await expect(verify(token)).rejects.toBeInstanceOf(KeyFetchError);
    expect(calls).toEqual([`${secureIssuer}/.well-known/openid-configuration`]);
  });

  it('is read when it is https for an https issuer', async () => {
    const calls: string[] = [];
    const verify = createVerifier({
      issuers: [secureIssuer],
      audience: API,
      clock: () => clock,
      fetch: discovery('https://id.example.test/jwks', calls),
    });
    const token = await mintToken(first, secureIssuer, API, Math.floor(T0 / 1000));
    await expect(verify(token)).resolves.toBeDefined();
    expect(calls).toContain('https://id.example.test/jwks');
  });

  it('may be http when the issuer itself is http', async () => {
    issuer.jwksUri = `${issuer.issuer}/jwks`;
    await expect(verifier()(await tokenFor(first))).resolves.toBeDefined();
  });

  it('is refused when an http issuer names an http address on another origin', async () => {
    issuer.jwksUri = 'http://other.example.test/jwks';
    await expect(verifier()(await tokenFor(first))).rejects.toBeInstanceOf(KeyFetchError);
  });
});
