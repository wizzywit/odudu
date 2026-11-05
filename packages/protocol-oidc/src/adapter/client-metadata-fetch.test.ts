import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  CIMD_MAX_BODY_BYTES,
  fetchCimdDocument,
  ResponseTimedOut,
  ResponseTooLarge,
  type CimdFetchDeps,
  type CimdResponse,
} from '#/adapter/client-metadata-fetch';

const NOW = new Date('2026-11-05T12:00:00.000Z');
const URL_OK = 'https://app.example.com/client.json';

function ok(overrides: Partial<CimdResponse> = {}): CimdResponse {
  return {
    status: 200,
    contentType: 'application/json; charset=utf-8',
    cacheControl: 'max-age=600',
    body: '{"client_id":"https://app.example.com/client.json"}',
    ...overrides,
  };
}

interface Calls {
  lookups: string[];
  requests: { url: string; address: string }[];
}

function deps(
  over: Partial<CimdFetchDeps> & { addresses?: string[]; response?: CimdResponse } = {},
): { deps: CimdFetchDeps; calls: Calls } {
  const calls: Calls = { lookups: [], requests: [] };
  const addresses = over.addresses ?? ['93.184.216.34'];
  return {
    calls,
    deps: {
      lookup:
        over.lookup ??
        ((host) => {
          calls.lookups.push(host);
          return Promise.resolve(addresses);
        }),
      request:
        over.request ??
        ((url, address) => {
          calls.requests.push({ url: url.href, address });
          return Promise.resolve(over.response ?? ok());
        }),
      now: () => NOW,
      ...(over.deadlineMs === undefined ? {} : { deadlineMs: over.deadlineMs }),
    },
  };
}

describe('fetchCimdDocument', () => {
  it('returns the parsed body and when it stops being fresh', async () => {
    const { deps: d } = deps();
    expect(await fetchCimdDocument(URL_OK, d)).toEqual({
      kind: 'ok',
      body: { client_id: URL_OK },
      cacheable: true,
      expiresAt: new Date(NOW.getTime() + 600_000),
    });
  });

  it('connects to the address it checked, resolving the name once', async () => {
    const { deps: d, calls } = deps({ addresses: ['93.184.216.34'] });
    await fetchCimdDocument(URL_OK, d);
    expect(calls.lookups).toEqual(['app.example.com']);
    expect(calls.requests).toEqual([{ url: URL_OK, address: '93.184.216.34' }]);
  });

  it('[CIMD-6.5-01] refuses a name that resolves to the cloud metadata address, sending nothing', async () => {
    const { deps: d, calls } = deps({ addresses: ['169.254.169.254'] });
    expect(await fetchCimdDocument(URL_OK, d)).toEqual({
      kind: 'refused',
      reason: 'private_address',
    });
    expect(calls.requests).toEqual([]);
  });

  it('refuses when any one of several answers is private', async () => {
    const { deps: d, calls } = deps({ addresses: ['93.184.216.34', '10.0.0.5'] });
    expect(await fetchCimdDocument(URL_OK, d)).toEqual({
      kind: 'refused',
      reason: 'private_address',
    });
    expect(calls.requests).toEqual([]);
  });

  it.each(['::ffff:169.254.169.254', '::ffff:7f00:1', '::ffff:10.0.0.1', '::1', 'fd00::1'])(
    'refuses a name that resolves to %s',
    async (address) => {
      const { deps: d } = deps({ addresses: [address] });
      expect(await fetchCimdDocument(URL_OK, d)).toEqual({
        kind: 'refused',
        reason: 'private_address',
      });
    },
  );

  it.each([
    'https://127.0.0.1/client.json',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/client.json',
    'https://[::ffff:169.254.169.254]/client.json',
    'https://10.1.2.3/client.json',
    'https://localhost/client.json',
    'https://LOCALHOST/client.json',
    'https://app.localhost/client.json',
  ])('refuses %s without a lookup or a request', async (url) => {
    const { deps: d, calls } = deps();
    expect(await fetchCimdDocument(url, d)).toEqual({ kind: 'refused', reason: 'private_address' });
    expect(calls.lookups).toEqual([]);
    expect(calls.requests).toEqual([]);
  });

  it('refuses a name that resolves to nothing', async () => {
    const { deps: d } = deps({ addresses: [] });
    expect(await fetchCimdDocument(URL_OK, d)).toEqual({ kind: 'refused', reason: 'unreachable' });
  });

  it('refuses a name that does not resolve', async () => {
    const { deps: d } = deps({ lookup: () => Promise.reject(new Error('ENOTFOUND')) });
    expect(await fetchCimdDocument(URL_OK, d)).toEqual({ kind: 'refused', reason: 'unreachable' });
  });

  it('refuses a plain http URL and one with credentials, before any lookup', async () => {
    const { deps: d, calls } = deps();
    expect(await fetchCimdDocument('http://app.example.com/c.json', d)).toEqual({
      kind: 'refused',
      reason: 'url_refused',
    });
    expect(await fetchCimdDocument('https://u:p@app.example.com/c.json', d)).toEqual({
      kind: 'refused',
      reason: 'url_refused',
    });
    expect(calls.lookups).toEqual([]);
  });

  it.each([301, 302, 307, 308])('does not follow a %s', async (status) => {
    const { deps: d, calls } = deps({ response: ok({ status, body: '' }) });
    expect(await fetchCimdDocument(URL_OK, d)).toEqual({ kind: 'refused', reason: 'redirect' });
    expect(calls.requests).toHaveLength(1);
  });

  it.each([404, 500, 204, 206])('refuses status %s, whatever the body', async (status) => {
    const { deps: d } = deps({ response: ok({ status }) });
    expect(await fetchCimdDocument(URL_OK, d)).toEqual({ kind: 'refused', reason: 'status' });
  });

  it('refuses a 204 with no body as a status, not as bad JSON', async () => {
    const { deps: d } = deps({ response: ok({ status: 204, body: '' }) });
    expect(await fetchCimdDocument(URL_OK, d)).toEqual({ kind: 'refused', reason: 'status' });
  });

  it.each([null, 'text/html', 'application/jsonish', 'application/jwk-set+json'])(
    'refuses content type %s',
    async (contentType) => {
      const { deps: d } = deps({ response: ok({ contentType }) });
      expect(await fetchCimdDocument(URL_OK, d)).toEqual({ kind: 'refused', reason: 'not_json' });
    },
  );

  it('accepts the media type in any case', async () => {
    const { deps: d } = deps({ response: ok({ contentType: 'Application/JSON' }) });
    expect((await fetchCimdDocument(URL_OK, d)).kind).toBe('ok');
  });

  it('refuses a body that is not JSON', async () => {
    const { deps: d } = deps({ response: ok({ body: '<html>' }) });
    expect(await fetchCimdDocument(URL_OK, d)).toEqual({ kind: 'refused', reason: 'not_json' });
  });

  it('[CIMD-6.6-01] refuses a body over five KiB even from a transport that did not stop it', async () => {
    const big = `{"x":"${'a'.repeat(CIMD_MAX_BODY_BYTES)}"}`;
    const { deps: d } = deps({ response: ok({ body: big }) });
    expect(await fetchCimdDocument(URL_OK, d)).toEqual({ kind: 'refused', reason: 'too_large' });
    expect(CIMD_MAX_BODY_BYTES).toBe(5 * 1024);
  });

  it('counts bytes, not characters', async () => {
    const wide = `{"x":"${'é'.repeat(CIMD_MAX_BODY_BYTES / 2)}"}`;
    const { deps: d } = deps({ response: ok({ body: wide }) });
    expect(await fetchCimdDocument(URL_OK, d)).toEqual({ kind: 'refused', reason: 'too_large' });
  });

  it('maps a transport that stopped reading to too_large and one that timed out to timeout', async () => {
    const large = deps({ request: () => Promise.reject(new ResponseTooLarge('cap')) });
    expect(await fetchCimdDocument(URL_OK, large.deps)).toEqual({
      kind: 'refused',
      reason: 'too_large',
    });
    const slow = deps({ request: () => Promise.reject(new ResponseTimedOut('slow')) });
    expect(await fetchCimdDocument(URL_OK, slow.deps)).toEqual({
      kind: 'refused',
      reason: 'timeout',
    });
  });

  it('refuses an unreachable host', async () => {
    const { deps: d } = deps({ request: () => Promise.reject(new Error('ECONNREFUSED')) });
    expect(await fetchCimdDocument(URL_OK, d)).toEqual({ kind: 'refused', reason: 'unreachable' });
  });

  it('enforces its own three-second deadline over lookup and request together', async () => {
    const { deps: d } = deps({
      deadlineMs: 20,
      request: () => new Promise<CimdResponse>(() => undefined),
    });
    expect(await fetchCimdDocument(URL_OK, d)).toEqual({ kind: 'refused', reason: 'timeout' });
  });

  it('enforces the deadline over a lookup that never answers', async () => {
    const { deps: d } = deps({
      deadlineMs: 20,
      lookup: () => new Promise<string[]>(() => undefined),
    });
    expect(await fetchCimdDocument(URL_OK, d)).toEqual({ kind: 'refused', reason: 'timeout' });
  });

  it('marks a no-store response as not to be kept', async () => {
    const { deps: d } = deps({ response: ok({ cacheControl: 'no-store' }) });
    const outcome = await fetchCimdDocument(URL_OK, d);
    expect(outcome).toMatchObject({ kind: 'ok', cacheable: false });
  });

  it('clamps the lifetime into one minute to a day', async () => {
    const short = await fetchCimdDocument(
      URL_OK,
      deps({ response: ok({ cacheControl: 'max-age=1' }) }).deps,
    );
    const long = await fetchCimdDocument(
      URL_OK,
      deps({ response: ok({ cacheControl: 'max-age=999999' }) }).deps,
    );
    expect(short).toMatchObject({ expiresAt: new Date(NOW.getTime() + 60_000) });
    expect(long).toMatchObject({ expiresAt: new Date(NOW.getTime() + 86_400_000) });
  });

  it('does not decompress a gzip response: its bytes are not JSON', async () => {
    const gz = Buffer.from(gzipSync('{"a":1}')).toString('latin1');
    const { deps: d } = deps({ response: ok({ body: gz }) });
    expect(await fetchCimdDocument(URL_OK, d)).toEqual({ kind: 'refused', reason: 'not_json' });
  });

  it.each([
    'https://2130706433/client.json',
    'https://0x7f.0.0.1/client.json',
    'https://017700000001/c.json',
  ])('refuses the numeric host in %s without a request', async (url) => {
    const { deps: d, calls } = deps({ addresses: ['127.0.0.1'] });
    expect(await fetchCimdDocument(url, d)).toEqual({ kind: 'refused', reason: 'private_address' });
    expect(calls.requests).toEqual([]);
  });
});
