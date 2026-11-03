import { expect, it } from 'vitest';
import evaluation from '#/features/clients/adapter/fixtures/evaluation.json';
import installation from '#/features/clients/adapter/fixtures/installation.json';
import deliveries from '#/features/clients/adapter/fixtures/logout-deliveries.json';
import sessions from '#/features/clients/adapter/fixtures/client-sessions.json';
import grants from '#/features/clients/adapter/fixtures/revoked-grants.json';
import {
  evaluateClaims,
  readClientSessionCount,
  readClientSessions,
  readInstallation,
  readLogoutDeliveries,
  revokeClientGrants,
} from '#/features/clients/adapter/operations';
import { fakeTransport, json } from '#/testing/fakeTransport';
import { C } from '#/testing/clientsFixtures';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const ID = '01a0ee8a-d1a7-7c3c-a05b-903a2d8fa123';
const SUBJECT = '01a0ee8a-c58a-716c-96a6-edcab4ca1a70';
const SESSION_COUNT = { count: 2, capped: false };

it("reads a client's sessions and counts the ones holding a grant through it", async () => {
  const fake = fakeTransport({
    [`GET ${C}/${ID}/sessions`]: json(sessions),
    [`GET ${ACME_ADMIN}/sessions/count`]: json(SESSION_COUNT),
  });
  const { gateway } = fake.transport;
  expect(
    await readClientSessions(gateway, 'acme', ID, new URLSearchParams({ limit: '2' })),
  ).toMatchObject({
    ok: true,
    data: sessions,
  });
  expect(fake.sent.at(-1)).toMatchObject({ method: 'GET', path: `${C}/${ID}/sessions` });
  expect(fake.sent.at(-1)?.search.get('limit')).toBe('2');
  expect(await readClientSessionCount(gateway, 'acme', ID)).toMatchObject({
    ok: true,
    data: { count: 2, capped: false },
  });
  expect(fake.sent.at(-1)?.search.get('client')).toBe(ID);
});

it("revokes the client's grants with a DELETE and no body, and says what was left", async () => {
  const fake = fakeTransport({ [`DELETE ${C}/${ID}/grants`]: json(grants) });
  expect(await revokeClientGrants(fake.transport.gateway, 'acme', ID)).toMatchObject({
    ok: true,
    data: grants,
  });
  expect(fake.sent.at(-1)).toMatchObject({
    method: 'DELETE',
    path: `${C}/${ID}/grants`,
    body: undefined,
  });
});

it('reads the logout deliveries queued for a client, narrowed by the query it is given', async () => {
  const fake = fakeTransport({ [`GET ${C}/${ID}/logout-deliveries`]: json(deliveries) });
  const query = new URLSearchParams({ status: 'pending' });
  expect(await readLogoutDeliveries(fake.transport.gateway, 'acme', ID, query)).toMatchObject({
    ok: true,
    data: deliveries,
  });
  expect(fake.sent.at(-1)).toMatchObject({
    method: 'GET',
    path: `${C}/${ID}/logout-deliveries`,
  });
  expect(fake.sent.at(-1)?.search.get('status')).toBe('pending');
});

it('reads what a relying party is configured with', async () => {
  const fake = fakeTransport({ [`GET ${C}/${ID}/installation`]: json(installation) });
  expect(await readInstallation(fake.transport.gateway, 'acme', ID)).toMatchObject({
    ok: true,
    data: installation,
  });
  expect(fake.sent.at(-1)).toMatchObject({ method: 'GET', path: `${C}/${ID}/installation` });
});

it('evaluates the claims for a subject, sending the scope only when one is named', async () => {
  const fake = fakeTransport({ [`GET ${C}/${ID}/evaluate`]: json(evaluation) });
  const { gateway } = fake.transport;
  expect(
    await evaluateClaims(gateway, 'acme', ID, {
      subject: SUBJECT,
      scope: ' openid profile email roles ',
    }),
  ).toMatchObject({ ok: true, data: evaluation });
  expect(fake.sent.at(-1)).toMatchObject({ method: 'GET', path: `${C}/${ID}/evaluate` });
  expect(fake.sent.at(-1)?.search.get('subject')).toBe(SUBJECT);
  expect(fake.sent.at(-1)?.search.get('scope')).toBe('openid profile email roles');
  await evaluateClaims(gateway, 'acme', ID, { subject: SUBJECT, scope: '  ' });
  expect(fake.sent.at(-1)?.search.has('scope')).toBe(false);
});
