import { expect, it } from 'vitest';
import count from '#/pages/clients/adapter/fixtures/client-count.json';
import detail from '#/pages/clients/adapter/fixtures/client.json';
import created from '#/pages/clients/adapter/fixtures/created-client.json';
import list from '#/pages/clients/adapter/fixtures/client-list.json';
import rotated from '#/pages/clients/adapter/fixtures/rotated-secret.json';
import {
  amendClient,
  createClient,
  deleteClient,
  findClient,
  readClient,
  readClientCount,
  readClientPage,
  rotateClientSecret,
} from '#/pages/clients/adapter/clients';
import { fakeTransport, json } from '#/testing/fakeTransport';
import { C } from '#/testing/clientsFixtures';

const [LISTED] = list.items;

it('pages the clients, searched and filtered by the server, and counts them', async () => {
  const fake = fakeTransport({
    [`GET ${C}`]: json(list),
    [`GET ${C}/count`]: json(count),
  });
  const gateway = fake.transport.gateway;
  const query = new URLSearchParams({ client_id: 'DEMO', type: 'public' });
  expect(await readClientPage(gateway, 'acme', query)).toMatchObject({ ok: true, data: list });
  expect(fake.sent.at(-1)?.search.get('client_id')).toBe('DEMO');
  expect(await readClientCount(gateway, 'acme', query)).toMatchObject({ ok: true, data: count });
  expect(fake.sent.at(-1)?.search.get('type')).toBe('public');
});

it('creates a confidential client with the secret method, and a public one with none', async () => {
  const fake = fakeTransport({ [`POST ${C}`]: json(created, 201, { etag: '"b1"' }) });
  const gateway = fake.transport.gateway;
  const made = await createClient(gateway, 'acme', {
    clientId: 'billing',
    name: 'Billing',
    description: '',
    kind: 'confidential',
    redirectUris: ['https://billing.example/callback'],
  });
  expect(made).toMatchObject({ ok: true, data: created });
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
    kind: 'public',
    redirectUris: ['https://portal.example/cb'],
  });
  expect(fake.sent.at(-1)?.body).toEqual({
    client_id: 'portal',
    description: 'Staff portal',
    token_endpoint_auth_method: 'none',
    redirect_uris: ['https://portal.example/cb'],
  });
});

it('creates a service with the client credentials grant and no redirect URI', async () => {
  const fake = fakeTransport({ [`POST ${C}`]: json(created, 201, { etag: '"b1"' }) });
  await createClient(fake.transport.gateway, 'acme', {
    clientId: 'worker',
    name: '',
    description: '',
    kind: 'service',
    redirectUris: ['https://ignored.example/cb'],
  });
  expect(fake.sent.at(-1)?.body).toEqual({
    client_id: 'worker',
    token_endpoint_auth_method: 'client_secret_basic',
    grant_types: ['client_credentials'],
  });
});

it('reads a client with its ETag, and amends it on the ETag given', async () => {
  const fake = fakeTransport({
    [`GET ${C}/${detail.id}`]: json(detail, 200, { etag: '"b1"' }),
    [`PATCH ${C}/${detail.id}`]: json(detail, 200, { etag: '"b2"' }),
  });
  const gateway = fake.transport.gateway;
  expect(await readClient(gateway, 'acme', detail.id)).toMatchObject({
    ok: true,
    etag: '"b1"',
    data: detail,
  });
  await amendClient(gateway, 'acme', detail.id, { web_origins: ['https://a.example'] }, '"b1"');
  expect(fake.sent.at(-1)).toMatchObject({
    body: { web_origins: ['https://a.example'] },
    ifMatch: '"b1"',
  });
});

it('clears an emptied description or page by sending null, since the server keeps no empty one', async () => {
  const fake = fakeTransport({ [`PATCH ${C}/c-bill`]: json(detail, 200, { etag: '"b2"' }) });
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
  const fake = fakeTransport({ [`PATCH ${C}/c-bill`]: json(detail, 200, { etag: '"b2"' }) });
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

it('looks for a client by its exact id in one bounded request', async () => {
  const fake = fakeTransport({ [`GET ${C}`]: json(list) });
  const found = await findClient(fake.transport.gateway, 'acme', LISTED?.client_id ?? '');
  expect(found).toMatchObject({ ok: true, data: LISTED });
  expect(fake.sent).toHaveLength(1);
  expect(fake.sent[0]?.search.get('client_id_exact')).toBe(LISTED?.client_id);
  expect(fake.sent[0]?.search.get('limit')).toBe('1');
});

it('finds no client when the server answers none', async () => {
  const fake = fakeTransport({ [`GET ${C}`]: json({ items: [] }) });
  expect(await findClient(fake.transport.gateway, 'acme', 'billing')).toMatchObject({
    ok: true,
    data: null,
  });
});

it('rotates the secret, naming how long the replaced one keeps working, and returns the new one', async () => {
  const fake = fakeTransport({ [`POST ${C}/${rotated.id}/secret`]: json(rotated) });
  expect(await rotateClientSecret(fake.transport.gateway, 'acme', rotated.id, 3600)).toMatchObject({
    ok: true,
    data: rotated,
  });
  expect(fake.sent.at(-1)?.search.get('grace_seconds')).toBe('3600');
});
