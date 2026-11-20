import { afterEach, describe, expect, it } from 'vitest';
import { discover } from '#/use-cases/discover';
import { OduduError } from '#/services/odudu-error';
import { startFakeServer, type FakeServer } from '#/testing/fake-server';

const HTTP = { allowInsecureRequests: true };
let fake: FakeServer | undefined;

afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

function metadataFor(issuer: string): Response {
  return Response.json({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
  });
}

describe('discover', () => {
  it('reads the metadata of the issuer', async () => {
    fake = await startFakeServer();
    const metadata = await discover(fake.issuer, HTTP);
    expect(metadata.issuer).toBe(fake.issuer);
    expect(metadata.token_endpoint).toBe(`${fake.issuer}/token`);
  });

  it('refuses metadata whose issuer differs', async () => {
    fake = await startFakeServer();
    fake.metadataIssuer = 'https://elsewhere.example/tenants/demo';
    const error = await discover(fake.issuer, HTTP).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OduduError);
    expect((error as OduduError).code).toBe('discovery_failed');
  });

  it('refuses an http issuer unless told otherwise', async () => {
    fake = await startFakeServer();
    const error = await discover(fake.issuer).catch((e: unknown) => e);
    expect((error as OduduError).code).toBe('discovery_failed');
    expect(fake.discoveryRequests).toBe(0);
  });

  it('caches per issuer and evicts at 256', async () => {
    const asked: string[] = [];
    const fetcher: typeof fetch = (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      asked.push(url.href);
      return Promise.resolve(
        metadataFor(url.href.replace('/.well-known/openid-configuration', '')),
      );
    };
    const issuer = (n: number): string => `https://cache.example/tenants/t${String(n)}`;
    const deps = { fetch: fetcher, now: () => 0 };
    for (let n = 0; n < 256; n += 1) await discover(issuer(n), deps);
    await discover(issuer(255), deps);
    expect(asked).toHaveLength(256);
    await discover(issuer(256), deps);
    expect(asked).toHaveLength(257);
    await discover(issuer(255), deps);
    expect(asked).toHaveLength(257);
    await discover(issuer(0), deps);
    expect(asked).toHaveLength(258);
  });

  it('asks again after an hour', async () => {
    let clock = 0;
    let asked = 0;
    const fetcher: typeof fetch = () => {
      asked += 1;
      return Promise.resolve(metadataFor('https://ttl.example/tenants/t'));
    };
    const deps = { fetch: fetcher, now: () => clock };
    await discover('https://ttl.example/tenants/t', deps);
    clock = 3_599_999;
    await discover('https://ttl.example/tenants/t', deps);
    expect(asked).toBe(1);
    clock = 3_600_000;
    await discover('https://ttl.example/tenants/t', deps);
    expect(asked).toBe(2);
  });

  it('does not cache a refusal', async () => {
    let asked = 0;
    const fetcher: typeof fetch = () => {
      asked += 1;
      return Promise.resolve(new Response('no', { status: 500 }));
    };
    const deps = { fetch: fetcher, now: () => 0 };
    await discover('https://down.example/tenants/t', deps).catch(() => undefined);
    await discover('https://down.example/tenants/t', deps).catch(() => undefined);
    expect(asked).toBe(2);
  });

  it('shares one request between concurrent callers', async () => {
    let asked = 0;
    const fetcher: typeof fetch = () => {
      asked += 1;
      return Promise.resolve(metadataFor('https://flight.example/tenants/t'));
    };
    const deps = { fetch: fetcher, now: () => 0 };
    await Promise.all([
      discover('https://flight.example/tenants/t', deps),
      discover('https://flight.example/tenants/t', deps),
    ]);
    expect(asked).toBe(1);
  });
});
