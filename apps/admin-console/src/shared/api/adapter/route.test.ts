import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  adminCall,
  adminRootCall,
  countReader,
  firstMatch,
  listReader,
  nothing,
  segment,
} from '#/shared/api/adapter/route';
import { fakeTransport, json } from '#/testing/fakeTransport';

describe('route helpers', () => {
  it('encodes a tenant name and an id for a path segment', () => {
    expect(segment('acme corp')).toBe('acme%20corp');
    expect(segment('a/b?c')).toBe('a%2Fb%3Fc');
  });

  it('accepts an empty body and refuses any other', () => {
    expect(nothing.safeParse(undefined).success).toBe(true);
    expect(nothing.safeParse({}).success).toBe(false);
  });
});

describe('listReader and countReader', () => {
  it('read a tenant collection with the query as given, the tenant encoded', async () => {
    const fake = fakeTransport({
      'GET /console/api/admin/tenants/acme%20corp/things': json({ items: [1], next: 'c2' }),
      'GET /console/api/admin/tenants/acme%20corp/things/count': json({ count: 3, capped: false }),
    });
    const query = new URLSearchParams({ name: 'a', limit: '5' });
    const page = listReader('things', z.object({ items: z.array(z.number()) }));
    expect(await page(fake.transport.gateway, 'acme corp', query)).toMatchObject({
      ok: true,
      data: { items: [1] },
    });
    expect(await countReader('things')(fake.transport.gateway, 'acme corp', query)).toMatchObject({
      ok: true,
      data: { count: 3, capped: false },
    });
    expect(fake.sent.map((sent) => sent.search.toString())).toEqual([
      'name=a&limit=5',
      'name=a&limit=5',
    ]);
  });

  it('reports a body its schema refuses as a schema failure', async () => {
    const fake = fakeTransport({
      'GET /console/api/admin/tenants/acme/things': json({ items: 'x' }),
    });
    const page = listReader('things', z.object({ items: z.array(z.number()) }));
    expect(await page(fake.transport.gateway, 'acme', new URLSearchParams())).toMatchObject({
      ok: false,
      kind: 'schema',
    });
  });
});

describe('adminCall', () => {
  it('encodes every part, sends the body and the ETag, and appends the query', async () => {
    const fake = fakeTransport({
      'PATCH /console/api/admin/tenants/acme/things/a%2Fb/sub': json({ ok: 1 }),
    });
    const result = await adminCall(
      fake.transport.gateway,
      'PATCH',
      'acme',
      ['things', 'a/b', 'sub'],
      {
        body: { x: 1 },
        ifMatch: '"v1"',
        query: new URLSearchParams({ q: 'y' }),
        schema: z.object({ ok: z.number() }),
      },
    );
    expect(result).toMatchObject({ ok: true, data: { ok: 1 } });
    expect(fake.sent[0]).toMatchObject({ body: { x: 1 }, ifMatch: '"v1"' });
    expect(fake.sent[0]?.search.get('q')).toBe('y');
  });

  it('sends no query string when there is none', async () => {
    const fake = fakeTransport({ 'GET /console/api/admin/tenants/acme/things': json({}) });
    await adminCall(fake.transport.gateway, 'GET', 'acme', ['things'], { schema: z.object({}) });
    expect(fake.sent[0]?.search.toString()).toBe('');
  });
});

describe('adminRootCall', () => {
  it('encodes every part under /admin and appends the query', async () => {
    const fake = fakeTransport({
      'GET /console/api/admin/tenants/acme%20corp': json({ ok: 1 }),
      'POST /console/api/admin/tenant-imports': json({ ok: 2 }),
    });
    const schema = z.object({ ok: z.number() });
    await adminRootCall(fake.transport.gateway, 'GET', ['tenants', 'acme corp'], {
      query: new URLSearchParams({ q: 'y' }),
      schema,
    });
    await adminRootCall(fake.transport.gateway, 'POST', ['tenant-imports'], { body: {}, schema });
    expect(fake.sent.map((sent) => `${sent.method} ${sent.path}`)).toEqual([
      'GET /console/api/admin/tenants/acme%20corp',
      'POST /console/api/admin/tenant-imports',
    ]);
    expect(fake.sent[0]?.search.get('q')).toBe('y');
    expect(fake.sent[1]?.search.toString()).toBe('');
  });
});

describe('firstMatch', () => {
  const page = {
    ok: true as const,
    status: 200,
    etag: null,
    next: null,
    data: { items: [{ n: 'ab' }, { n: 'a' }] },
  };

  it('picks the item that matches whole, or none', () => {
    expect(firstMatch(page, (item) => item.n === 'a')).toMatchObject({
      ok: true,
      data: { n: 'a' },
    });
    expect(firstMatch(page, (item) => item.n === 'x')).toMatchObject({ ok: true, data: null });
  });

  it('passes a failure through', () => {
    const failed = { ok: false as const, kind: 'network' as const };
    expect(firstMatch(failed, () => true)).toBe(failed);
  });
});
