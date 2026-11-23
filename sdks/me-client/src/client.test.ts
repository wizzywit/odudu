import { afterEach, describe, expect, it } from 'vitest';
import { createMeClient, iterate, ProblemError } from '#/index';
import { json, startFakeApi, type FakeApi, type Reply } from '#/testing/fake-api';

const open: FakeApi[] = [];

async function api(handler: (index: number, url: string) => Reply): Promise<FakeApi> {
  const started = await startFakeApi((request, index) => handler(index, request.url));
  open.push(started);
  return started;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((server) => server.close()));
});

describe('the me client', () => {
  it('the tenant is filled into the path and the token is sent', async () => {
    const server = await api(() => json(200, { name: null }));
    const client = createMeClient({ baseUrl: server.origin, tenant: 'acme', token: 'tok' });
    await client.GET('/tenants/{tenant}/me/profile');
    expect(server.requests[0]?.url).toBe('/tenants/acme/me/profile');
    expect(server.requests[0]?.headers.authorization).toBe('Bearer tok');
  });

  it('an async token provider is called per request', async () => {
    const server = await api(() => json(200, { name: null }));
    let calls = 0;
    const client = createMeClient({
      baseUrl: server.origin,
      tenant: 'acme',
      token: () => Promise.resolve(`token-${String(++calls)}`),
    });
    await client.GET('/tenants/{tenant}/me/profile');
    await client.GET('/tenants/{tenant}/me/profile');
    expect(server.requests.map((r) => r.headers.authorization)).toEqual([
      'Bearer token-1',
      'Bearer token-2',
    ]);
  });

  it('a 409 throws ProblemError with the error code and description', async () => {
    const server = await api(() =>
      json(409, { error: 'last_sign_in_method', error_description: 'It is the last one.' }),
    );
    const client = createMeClient({ baseUrl: server.origin, tenant: 'acme', token: 't' });
    const failure = await client
      .DELETE('/tenants/{tenant}/me/credentials/{id}', { params: { path: { id: 'c1' } } })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProblemError);
    expect((failure as ProblemError).status).toBe(409);
    expect((failure as ProblemError).code).toBe('last_sign_in_method');
    expect((failure as ProblemError).detail).toBe('It is the last one.');
  });

  it('a 401 with no body throws ProblemError with the status alone', async () => {
    const server = await api(() => ({
      status: 401,
      headers: { 'www-authenticate': 'Bearer error="invalid_token"' },
    }));
    const client = createMeClient({ baseUrl: server.origin, tenant: 'acme', token: 't' });
    const failure = await client
      .GET('/tenants/{tenant}/me/profile')
      .catch((error: unknown) => error);
    expect((failure as ProblemError).status).toBe(401);
    expect((failure as ProblemError).response.headers.get('www-authenticate')).toContain('Bearer');
  });

  it('sends no Idempotency-Key, the me document marks none', async () => {
    const server = await api(() => json(200, { name: null }));
    const client = createMeClient({ baseUrl: server.origin, tenant: 'acme', token: 't' });
    await client.PATCH('/tenants/{tenant}/me/profile', { body: { name: 'Ada' } });
    expect(server.requests[0]?.headers['idempotency-key']).toBeUndefined();
  });

  it('iterate follows next_cursor and stops at maxItems', async () => {
    const server = await api((_index, url) => {
      const query = new URL(url, 'http://x').searchParams;
      const start = Number(query.get('cursor') ?? '0');
      const items = Array.from({ length: Number(query.get('limit')) }, (_, i) => ({
        id: `s${String(start + i)}`,
      }));
      return json(200, { items, next_cursor: String(start + items.length) });
    });
    const client = createMeClient({ baseUrl: server.origin, tenant: 'acme', token: 't' });
    const ids: string[] = [];
    for await (const session of iterate(
      (page) => client.GET('/tenants/{tenant}/me/sessions', { params: { query: page } }),
      { pageLimit: 2, maxItems: 5 },
    )) {
      ids.push(session.id);
    }
    expect(ids).toEqual(['s0', 's1', 's2', 's3', 's4']);
    expect(server.requests).toHaveLength(3);
  });

  it('GET retries a 503 once then succeeds', async () => {
    const server = await api((index) => (index === 0 ? json(503, {}) : json(200, { name: null })));
    const client = createMeClient({
      baseUrl: server.origin,
      tenant: 'acme',
      token: 't',
      sleep: () => Promise.resolve(),
    });
    await client.GET('/tenants/{tenant}/me/profile');
    expect(server.requests).toHaveLength(2);
  });
});
