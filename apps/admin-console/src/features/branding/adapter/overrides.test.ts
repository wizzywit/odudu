import { describe, expect, it } from 'vitest';
import { deleteOverride, putOverride, readOverride } from '#/features/branding/adapter/overrides';
import { MO, override, TITLE_OVERRIDE } from '#/testing/brandingFixtures';
import { fakeTransport, json } from '#/testing/fakeTransport';

const PUT = `PUT ${MO}/en/login.title`;
const sentOf = (fake: ReturnType<typeof fakeTransport>) => fake.sent[0];

describe('writing an override', () => {
  it('creates under If-None-Match: * and sends no If-Match', async () => {
    const fake = fakeTransport({ [PUT]: json(TITLE_OVERRIDE) });
    await putOverride(fake.transport.gateway, 'acme', {
      locale: 'en',
      key: 'login.title',
      message: 'Hi',
      etag: null,
    });
    expect(sentOf(fake)).toMatchObject({ ifNoneMatch: '*', ifMatch: null });
  });

  it('changes under the version it read', async () => {
    const fake = fakeTransport({ [PUT]: json(TITLE_OVERRIDE) });
    await putOverride(fake.transport.gateway, 'acme', {
      locale: 'en',
      key: 'login.title',
      message: 'Hi',
      etag: '"v1"',
    });
    expect(sentOf(fake)).toMatchObject({ ifMatch: '"v1"', ifNoneMatch: null });
  });

  it('removes under the version it read', async () => {
    const fake = fakeTransport({
      [`DELETE ${MO}/en/login.title`]: () => new Response(null, { status: 204 }),
    });
    await deleteOverride(fake.transport.gateway, 'acme', {
      locale: 'en',
      key: 'login.title',
      etag: '"v1"',
    });
    expect(sentOf(fake)).toMatchObject({ method: 'DELETE', ifMatch: '"v1"' });
  });
});

describe('reading one override', () => {
  it('follows the pages until the key is found', async () => {
    const fake = fakeTransport({
      [`GET ${MO}`]: (request) =>
        json(
          request.search.get('cursor') === null
            ? { items: [override('a.one', 'x')], next: 'c2' }
            : { items: [TITLE_OVERRIDE] },
        )(request),
    });
    const result = await readOverride(fake.transport.gateway, 'acme', {
      locale: 'en',
      key: 'login.title',
    });
    expect(result).toMatchObject({ ok: true, data: TITLE_OVERRIDE });
    expect(fake.sent).toHaveLength(2);
    expect(fake.sent[0]?.search.get('limit')).toBe('200');
  });

  it('answers null for a key the language no longer holds', async () => {
    const fake = fakeTransport({ [`GET ${MO}`]: json({ items: [override('a.one', 'x')] }) });
    const result = await readOverride(fake.transport.gateway, 'acme', {
      locale: 'en',
      key: 'gone',
    });
    expect(result).toMatchObject({ ok: true, data: null });
  });

  it('gives up as a defect when the pages never end, instead of reading on', async () => {
    const fake = fakeTransport({
      [`GET ${MO}`]: json({ items: [override('a.one', 'x')], next: 'more' }),
    });
    const result = await readOverride(fake.transport.gateway, 'acme', {
      locale: 'en',
      key: 'login.title',
    });
    expect(result).toEqual({ ok: false, kind: 'defect' });
    expect(fake.sent).toHaveLength(3);
  });
});
