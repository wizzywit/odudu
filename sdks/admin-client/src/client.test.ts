import { afterEach, describe, expect, it } from 'vitest';
import { createAdminClient, iterate, ProblemError } from '#/index';
import { json, startFakeApi, type FakeApi, type Reply } from '#/testing/fake-api';

const noSleep = (): Promise<void> => Promise.resolve();
const open: FakeApi[] = [];

async function api(handler: (index: number, url: string) => Reply): Promise<FakeApi> {
  const started = await startFakeApi((request, index) => handler(index, request.url));
  open.push(started);
  return started;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((server) => server.close()));
});

const SUBJECT = { id: '0190c9b2-7a3e-7000-8000-000000000001', username: 'ada' };

describe('the admin client', () => {
  it('the tenant is filled into the path', async () => {
    const server = await api(() => json(200, { items: [] }));
    const client = createAdminClient({ baseUrl: server.origin, tenant: 'acme corp', token: 'tok' });
    await client.GET('/admin/tenants/{tenant}/clients', { params: { query: { limit: 5 } } });
    expect(server.requests[0]?.url).toBe('/admin/tenants/acme%20corp/clients?limit=5');
    expect(server.requests[0]?.headers.authorization).toBe('Bearer tok');
  });

  it('keeps the other path parameters the caller passes', async () => {
    const server = await api(() => json(200, {}));
    const client = createAdminClient({ baseUrl: `${server.origin}/`, tenant: 'acme', token: 't' });
    await client.GET('/admin/tenants/{tenant}/clients/{id}', { params: { path: { id: 'c/1' } } });
    expect(server.requests[0]?.url).toBe('/admin/tenants/acme/clients/c%2F1');
  });

  it('an async token provider is called per request', async () => {
    const server = await api(() => json(200, { items: [] }));
    let calls = 0;
    const client = createAdminClient({
      baseUrl: server.origin,
      tenant: 'acme',
      token: () => Promise.resolve(`token-${String(++calls)}`),
    });
    await client.GET('/admin/tenants/{tenant}/clients');
    await client.GET('/admin/tenants/{tenant}/clients');
    expect(calls).toBe(2);
    expect(server.requests.map((r) => r.headers.authorization)).toEqual([
      'Bearer token-1',
      'Bearer token-2',
    ]);
  });

  it('a 409 throws ProblemError with code and detail', async () => {
    const server = await api(() =>
      json(409, {
        type: 'about:blank#idempotency-in-progress',
        title: 'Conflict',
        status: 409,
        instance: '01a1',
        detail: 'A request with this key is still running.',
        errors: [{ path: 'username', message: 'taken' }],
      }),
    );
    const client = createAdminClient({ baseUrl: server.origin, tenant: 'acme', token: 't' });
    const failure: unknown = await client
      .POST('/admin/tenants/{tenant}/roles', { body: { name: 'r' } })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProblemError);
    const problem = failure as ProblemError;
    expect(problem.status).toBe(409);
    expect(problem.code).toBe('idempotency-in-progress');
    expect(problem.detail).toBe('A request with this key is still running.');
    expect(problem.errors).toEqual([{ path: 'username', message: 'taken' }]);
    expect(problem.message).toContain('still running');
  });

  it('POST sends an Idempotency-Key and a retry reuses it', async () => {
    const server = await api((index) => (index === 0 ? json(503, {}) : json(201, SUBJECT)));
    const client = createAdminClient({
      baseUrl: server.origin,
      tenant: 'acme',
      token: 't',
      sleep: noSleep,
    });
    const { data } = await client.POST('/admin/tenants/{tenant}/subjects', {
      body: { username: 'ada' },
    });
    expect(data).toMatchObject({ username: 'ada' });
    expect(server.requests).toHaveLength(2);
    const keys = server.requests.map((r) => r.headers['idempotency-key']);
    expect(typeof keys[0]).toBe('string');
    expect(keys[1]).toBe(keys[0]);
    expect(server.requests[1]?.body).toBe(server.requests[0]?.body);
  });

  it('uses a new key for the next logical call', async () => {
    const server = await api(() => json(201, SUBJECT));
    const client = createAdminClient({ baseUrl: server.origin, tenant: 'acme', token: 't' });
    await client.POST('/admin/tenants/{tenant}/subjects', { body: { username: 'a' } });
    await client.POST('/admin/tenants/{tenant}/subjects', { body: { username: 'b' } });
    const [first, second] = server.requests.map((r) => r.headers['idempotency-key']);
    expect(first).not.toBe(second);
  });

  it('keeps a key the caller supplies', async () => {
    const server = await api(() => json(201, SUBJECT));
    const client = createAdminClient({ baseUrl: server.origin, tenant: 'acme', token: 't' });
    await client.POST('/admin/tenants/{tenant}/subjects', {
      body: { username: 'a' },
      params: { header: { 'Idempotency-Key': 'mine-1' } },
    });
    expect(server.requests[0]?.headers['idempotency-key']).toBe('mine-1');
  });

  it('a POST to an operation without the key marker sends no Idempotency-Key and is never retried', async () => {
    const server = await api(() => json(503, {}));
    const client = createAdminClient({
      baseUrl: server.origin,
      tenant: 'acme',
      token: 't',
      sleep: noSleep,
    });
    const failure = await client
      .POST('/admin/tenants/{tenant}/clients', { body: { client_id: 'web' } })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProblemError);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.headers['idempotency-key']).toBeUndefined();
  });

  it('GET retries a 503 once then succeeds, waiting between attempts', async () => {
    const server = await api((index) => (index === 0 ? json(503, {}) : json(200, { items: [] })));
    const waits: number[] = [];
    const client = createAdminClient({
      baseUrl: server.origin,
      tenant: 'acme',
      token: 't',
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    const { data } = await client.GET('/admin/tenants/{tenant}/clients');
    expect(data).toEqual({ items: [] });
    expect(server.requests).toHaveLength(2);
    expect(waits).toHaveLength(1);
  });

  it('gives up after two retries', async () => {
    const server = await api(() => json(429, {}, { 'retry-after': '1' }));
    const client = createAdminClient({
      baseUrl: server.origin,
      tenant: 'acme',
      token: 't',
      sleep: noSleep,
    });
    const failure = await client
      .GET('/admin/tenants/{tenant}/clients')
      .catch((error: unknown) => error);
    expect((failure as ProblemError).status).toBe(429);
    expect(server.requests).toHaveLength(3);
  });

  it('a non-JSON 502 throws ProblemError without echoing the body', async () => {
    const secret = 'upstream-internal-hostname';
    const server = await api(() => ({
      status: 502,
      headers: { 'content-type': 'text/html' },
      body: `<html>${secret}${'x'.repeat(100_000)}</html>`,
    }));
    const client = createAdminClient({
      baseUrl: server.origin,
      tenant: 'acme',
      token: 't',
      sleep: noSleep,
    });
    const failure = await client
      .GET('/admin/tenants/{tenant}/clients')
      .catch((error: unknown) => error);
    const problem = failure as ProblemError;
    expect(problem).toBeInstanceOf(ProblemError);
    expect(problem.status).toBe(502);
    expect(problem.code).toBeUndefined();
    expect(problem.detail).toBeUndefined();
    expect(problem.message).not.toContain(secret);
    expect(problem.message.length).toBeLessThan(200);
  });

  it('the client never sends the token to a different origin than baseUrl', async () => {
    const elsewhere = await api(() => json(200, {}));
    const server = await api(() => ({
      status: 302,
      headers: { location: `${elsewhere.origin}/steal` },
    }));
    const client = createAdminClient({ baseUrl: server.origin, tenant: 'acme', token: 'secret' });
    const failure = await client
      .GET('/admin/tenants/{tenant}/clients')
      .catch((error: unknown) => error);
    expect((failure as ProblemError).status).toBe(302);
    expect(server.requests).toHaveLength(1);
    expect(elsewhere.requests).toHaveLength(0);
  });

  it('uses the fetch the caller supplies', async () => {
    const seen: string[] = [];
    const client = createAdminClient({
      baseUrl: 'http://api.test',
      tenant: 'acme',
      token: 't',
      fetch: (input, init) => {
        seen.push(new Request(input, init).url);
        return Promise.resolve(Response.json({ items: [] }));
      },
    });
    await client.GET('/admin/tenants/{tenant}/clients');
    expect(seen).toEqual(['http://api.test/admin/tenants/acme/clients']);
  });

  it('refuses a baseUrl that is not an absolute http(s) URL', () => {
    const options = { tenant: 'acme', token: 't' };
    expect(() => createAdminClient({ ...options, baseUrl: '/relative' })).toThrow(/baseUrl/u);
    expect(() => createAdminClient({ ...options, baseUrl: 'ftp://x' })).toThrow(/baseUrl/u);
  });
});

describe('iterate', () => {
  function clientsApi(total: number, seen: string[]): Promise<FakeApi> {
    return api((_index, url) => {
      seen.push(url);
      const query = new URL(url, 'http://x').searchParams;
      const limit = Number(query.get('limit'));
      const start = Number(query.get('cursor') ?? '0');
      const end = Math.min(start + limit, total);
      const items = Array.from({ length: end - start }, (_, i) => ({ n: start + i }));
      return json(200, end < total ? { items, next: String(end) } : { items });
    });
  }

  it('iterate stops at maxItems', async () => {
    const seen: string[] = [];
    const server = await clientsApi(1000, seen);
    const client = createAdminClient({ baseUrl: server.origin, tenant: 'acme', token: 't' });
    const items: unknown[] = [];
    for await (const item of iterate(
      (page) => client.GET('/admin/tenants/{tenant}/clients', { params: { query: page } }),
      { pageLimit: 2, maxItems: 5 },
    )) {
      items.push(item);
    }
    expect(items).toHaveLength(5);
    expect(server.requests).toHaveLength(3);
    expect(seen.map((url) => new URL(url, 'http://x').searchParams.get('limit'))).toEqual([
      '2',
      '2',
      '1',
    ]);
  });

  it('iterate never asks for more than pageLimit and follows nextCursor', async () => {
    const seen: string[] = [];
    const server = await clientsApi(7, seen);
    const client = createAdminClient({ baseUrl: server.origin, tenant: 'acme', token: 't' });
    const numbers: number[] = [];
    for await (const item of iterate(
      (page) => client.GET('/admin/tenants/{tenant}/clients', { params: { query: page } }),
      { pageLimit: 3 },
    )) {
      numbers.push((item as unknown as { n: number }).n);
    }
    expect(numbers).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const queries = seen.map((url) => new URL(url, 'http://x').searchParams);
    expect(queries.map((q) => q.get('cursor'))).toEqual([null, '3', '6']);
    expect(queries.every((q) => q.get('limit') === '3')).toBe(true);
  });

  it('defaults to 50 per page', async () => {
    const seen: string[] = [];
    const server = await clientsApi(1, seen);
    const client = createAdminClient({ baseUrl: server.origin, tenant: 'acme', token: 't' });
    for await (const item of iterate((page) =>
      client.GET('/admin/tenants/{tenant}/clients', { params: { query: page } }),
    )) {
      expect(item).toBeDefined();
    }
    expect(new URL(seen[0] ?? '', 'http://x').searchParams.get('limit')).toBe('50');
  });

  it('stops on an empty page even when a cursor is offered', async () => {
    const server = await api(() => json(200, { items: [], next: 'again' }));
    const client = createAdminClient({ baseUrl: server.origin, tenant: 'acme', token: 't' });
    const items: unknown[] = [];
    for await (const item of iterate((page) =>
      client.GET('/admin/tenants/{tenant}/clients', { params: { query: page } }),
    )) {
      items.push(item);
    }
    expect(items).toEqual([]);
    expect(server.requests).toHaveLength(1);
  });

  it('throws ProblemError for an error response', async () => {
    const server = await api(() =>
      json(403, { type: 'about:blank#forbidden', title: 'Forbidden', status: 403, instance: 'i' }),
    );
    const client = createAdminClient({ baseUrl: server.origin, tenant: 'acme', token: 't' });
    const run = async (): Promise<void> => {
      for await (const item of iterate((page) =>
        client.GET('/admin/tenants/{tenant}/clients', { params: { query: page } }),
      )) {
        expect(item).toBeDefined();
      }
    };
    await expect(run()).rejects.toBeInstanceOf(ProblemError);
  });

  it('refuses bounds that are not positive integers', async () => {
    const call = (): Promise<{ data: { items: number[] } }> =>
      Promise.resolve({ data: { items: [] } });
    await expect(iterate(call, { pageLimit: 0 }).next()).rejects.toThrow(RangeError);
    await expect(iterate(call, { maxItems: 1.5 }).next()).rejects.toThrow(RangeError);
  });
});
