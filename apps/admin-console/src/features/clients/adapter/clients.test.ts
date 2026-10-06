import { expect, it } from 'vitest';
import {
  amendClient,
  createClient,
  deleteClient,
  findClient,
  readClient,
  readClientCount,
  readClientPage,
} from '#/features/clients/adapter/clients.ts';
import { fakeTransport, json } from '#/testing/fakeTransport.ts';
import { BILLING, C, client, PORTAL } from '#/testing/clientsFixtures.ts';

it('pages the clients, searched and filtered by the server, and counts them', async () => {
  const fake = fakeTransport({
    [`GET ${C}`]: json({ items: [BILLING], next: 'n1' }),
    [`GET ${C}/count`]: json({ count: 1, capped: false }),
  });
  const gateway = fake.transport.gateway;
  const query = new URLSearchParams({ name: 'bil', type: 'confidential' });
  expect(await readClientPage(gateway, 'acme', query)).toMatchObject({
    ok: true,
    data: { items: [BILLING], next: 'n1' },
  });
  expect(fake.sent.at(-1)?.search.get('name')).toBe('bil');
  await readClientCount(gateway, 'acme', query);
  expect(fake.sent.at(-1)?.search.get('type')).toBe('confidential');
});

it('creates a confidential client with the secret method, and a public one with none', async () => {
  const fake = fakeTransport({
    [`POST ${C}`]: json({ ...BILLING, client_secret: 'shh' }, 201, { etag: '"b1"' }),
  });
  const gateway = fake.transport.gateway;
  const made = await createClient(gateway, 'acme', {
    clientId: 'billing',
    name: 'Billing',
    description: '',
    type: 'confidential',
    redirectUris: ['https://billing.example/callback'],
  });
  expect(made).toMatchObject({ ok: true, data: { client_secret: 'shh' } });
  expect(fake.sent.at(-1)?.body).toEqual({
    client_id: 'billing',
    name: 'Billing',
    token_endpoint_auth_method: 'client_secret_basic',
    redirect_uris: ['https://billing.example/callback'],
  });
  await createClient(gateway, 'acme', {
    clientId: 'portal',
    name: '',
    description: 'Staff portal',
    type: 'public',
    redirectUris: ['https://portal.example/cb'],
  });
  expect(fake.sent.at(-1)?.body).toEqual({
    client_id: 'portal',
    description: 'Staff portal',
    token_endpoint_auth_method: 'none',
    redirect_uris: ['https://portal.example/cb'],
  });
});

it('reads a client with its ETag, and amends it on the ETag given', async () => {
  const fake = fakeTransport({
    [`GET ${C}/c-bill`]: json(BILLING, 200, { etag: '"b1"' }),
    [`PATCH ${C}/c-bill`]: json(BILLING, 200, { etag: '"b2"' }),
  });
  const gateway = fake.transport.gateway;
  expect(await readClient(gateway, 'acme', 'c-bill')).toMatchObject({ ok: true, etag: '"b1"' });
  await amendClient(gateway, 'acme', 'c-bill', { web_origins: ['https://a.example'] }, '"b1"');
  expect(fake.sent.at(-1)).toMatchObject({
    body: { web_origins: ['https://a.example'] },
    ifMatch: '"b1"',
  });
});

it('clears an emptied description or page by sending null, since the server keeps no empty one', async () => {
  const fake = fakeTransport({ [`PATCH ${C}/c-bill`]: json(BILLING, 200, { etag: '"b2"' }) });
  const gateway = fake.transport.gateway;
  await amendClient(
    gateway,
    'acme',
    'c-bill',
    { description: '', client_uri: '', policy_uri: 'https://p.example', tos_uri: '' },
    '"b1"',
  );
  expect(fake.sent.at(-1)?.body).toEqual({
    description: null,
    client_uri: null,
    policy_uri: 'https://p.example',
    tos_uri: null,
  });
});

it('sends a list without the rows left empty or padded', async () => {
  const fake = fakeTransport({ [`PATCH ${C}/c-bill`]: json(BILLING, 200, { etag: '"b2"' }) });
  const gateway = fake.transport.gateway;
  await amendClient(
    gateway,
    'acme',
    'c-bill',
    { redirect_uris: ['https://a.example/cb ', '', '  '] },
    '"b1"',
  );
  expect(fake.sent.at(-1)?.body).toEqual({ redirect_uris: ['https://a.example/cb'] });
});

it('deletes a client', async () => {
  const fake = fakeTransport({ [`DELETE ${C}/c-bill`]: () => new Response(null, { status: 204 }) });
  expect(await deleteClient(fake.transport.gateway, 'acme', 'c-bill')).toMatchObject({ ok: true });
});

it('looks for a client by its id, paging while the ids sort no later than it', async () => {
  const folded = client('c-x', 'billing');
  const fake = fakeTransport({
    [`GET ${C}`]: (request) =>
      json(
        request.search.get('cursor') === null
          ? { items: [folded], next: 'n1' }
          : { items: [client('c-bill', 'Billing'), PORTAL] },
      )(request),
  });
  const found = await findClient(fake.transport.gateway, 'acme', 'Billing');
  expect(found).toMatchObject({ ok: true, data: { id: 'c-bill' } });
  expect(fake.sent.map((s) => s.search.get('client_id'))).toEqual(['Billing', 'Billing']);
  expect(fake.sent.at(-1)?.search.get('cursor')).toBe('n1');
});

it('finds no client when the ids run past the one asked for', async () => {
  const fake = fakeTransport({ [`GET ${C}`]: json({ items: [PORTAL], next: 'n1' }) });
  expect(await findClient(fake.transport.gateway, 'acme', 'billing')).toMatchObject({
    ok: true,
    data: null,
  });
  expect(fake.sent).toHaveLength(1);
});
