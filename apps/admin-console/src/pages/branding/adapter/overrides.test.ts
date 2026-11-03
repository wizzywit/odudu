import { describe, expect, it } from 'vitest';
import {
  deleteOverride,
  putOverride,
  readOverride,
  readOverridePage,
} from '#/pages/branding/adapter/overrides';
import listed from '#/pages/branding/adapter/fixtures/overrides.json';
import saved from '#/pages/branding/adapter/fixtures/override-saved.json';
import { MO, override } from '#/testing/brandingFixtures';
import { fakeTransport, json } from '#/testing/fakeTransport';

// The override answers are the response bodies of the message-overrides
// transcript (get-message-overrides-put-message-overrides-and-delete-message-overrides).

const PUT = `PUT ${MO}/en/login.title`;
const [HELD] = listed.items;
const sentOf = (fake: ReturnType<typeof fakeTransport>) => fake.sent[0];

describe('writing an override', () => {
  it('creates under If-None-Match: * and sends no If-Match', async () => {
    const fake = fakeTransport({ [PUT]: json(saved, 201) });
    const result = await putOverride(fake.transport.gateway, 'acme', {
      locale: 'en',
      key: 'login.title',
      message: 'Hi',
      etag: null,
    });
    expect(result).toMatchObject({ ok: true, data: saved });
    expect(sentOf(fake)).toMatchObject({ ifNoneMatch: '*', ifMatch: null });
  });

  it('changes under the version it read', async () => {
    const fake = fakeTransport({ [PUT]: json(saved) });
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
            : listed,
        )(request),
    });
    const result = await readOverride(fake.transport.gateway, 'acme', {
      locale: 'fr',
      key: 'login.title',
    });
    expect(result).toMatchObject({ ok: true, data: HELD });
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

describe('reading a language’s overrides', () => {
  it('reads one page of a language, from the cursor it is given', async () => {
    const fake = fakeTransport({ [`GET ${MO}`]: json(listed) });
    const query = new URLSearchParams({ locale: 'fr', limit: '50' });
    expect(await readOverridePage(fake.transport.gateway, 'acme', query)).toMatchObject({
      ok: true,
      data: listed,
    });
    expect(Object.fromEntries(fake.sent[0]?.search ?? [])).toEqual({ locale: 'fr', limit: '50' });
  });
});
