import { expect, it } from 'vitest';
import listed from '#/entities/signing-key/adapter/fixtures/keys-list.json';
import rotated from '#/entities/signing-key/adapter/fixtures/keys-list-rotated.json';
import { readKeyPage, readKeys } from '#/entities/signing-key/adapter/signingKeys';
import { fakeTransport, inTurn, json } from '#/testing/fakeTransport';
import { KEYS } from '#/testing/keysFixtures';

// keys-list.json and keys-list-rotated.json are the first and last listings of the
// get-keys-post-keys-post-keysidpromote-and-post-keysidretire transcript, verbatim.
// No transcript shows a second page, so the cursors below are invented.
it('reads a page of the keys, passing the status filter and the cursor on', async () => {
  const fake = fakeTransport({ [`GET ${KEYS}`]: json(listed) });
  const query = new URLSearchParams({ status: 'active', limit: '1', cursor: 'a.b' });
  const result = await readKeyPage(fake.transport.gateway, 'acme', query);
  expect(result).toMatchObject({ ok: true, data: listed });
  expect(fake.sent[0]).toMatchObject({ method: 'GET', path: KEYS });
  expect(fake.sent[0]?.search.get('status')).toBe('active');
  expect(fake.sent[0]?.search.get('limit')).toBe('1');
  expect(fake.sent[0]?.search.get('cursor')).toBe('a.b');
});

it('refuses a listed key that carries nothing of what a key has', async () => {
  const fake = fakeTransport({ [`GET ${KEYS}`]: json({ items: [{ id: 'x' }] }) });
  expect(await readKeyPage(fake.transport.gateway, 'acme', new URLSearchParams())).toMatchObject({
    ok: false,
    kind: 'schema',
  });
});

it('reads every signing key, following the cursor to the last page', async () => {
  const [first, second] = rotated.items;
  const fake = fakeTransport({
    [`GET ${KEYS}`]: inTurn(json({ items: [first], next: 'c1' }), json({ items: [second] })),
  });
  const result = await readKeys(fake.transport.gateway, 'acme');
  expect(result).toMatchObject({ ok: true, data: rotated.items });
  expect(fake.sent.map((sent) => sent.search.toString())).toEqual([
    'limit=200',
    'limit=200&cursor=c1',
  ]);
});

it('gives up, and says so, on a key list whose cursor never ends', async () => {
  const fake = fakeTransport({
    [`GET ${KEYS}`]: json({ items: listed.items, next: 'again' }),
  });
  const logged: string[] = [];
  const result = await readKeys(fake.transport.gateway, 'acme', (message) => {
    logged.push(message);
  });
  expect(result).toEqual({ ok: false, kind: 'defect' });
  expect(fake.calls).toHaveLength(10);
  expect(logged).toEqual(['console defect: GET keys of acme still had a next page after 10 pages']);
});

it('reads nothing more after a page that failed', async () => {
  const fake = fakeTransport({});
  expect(await readKeys(fake.transport.gateway, 'acme')).toMatchObject({ ok: false });
  expect(fake.calls).toHaveLength(1);
});
