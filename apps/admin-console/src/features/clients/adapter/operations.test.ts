import { expect, it } from 'vitest';
import {
  evaluateClaims,
  readClientSessionCount,
  readClientSessions,
  readInstallation,
  readLogoutDeliveries,
  revokeClientGrants,
} from '#/features/clients/adapter/operations';
import { fakeTransport, type Answer } from '#/testing/fakeTransport';
import { C } from '#/testing/clientsFixtures';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const ID = '01a0ee8a-d1a7-7c3c-a05b-903a2d8fa123';
const SUBJECT = '01a0ee8a-c58a-716c-96a6-edcab4ca1a70';

// A response block of a transcript, byte for byte.
function served(text: string): Answer {
  return () => new Response(text, { headers: { 'content-type': 'application/json' } });
}

const SESSIONS = `{"items":[{"id":"01a0ee8b-27fa-7271-bb21-8bf1dec2d0fa","subject_id":"01a0ee8a-c58a-716c-96a6-edcab4ca1a70","username":"grace","created_at":"2026-09-29T19:01:32.281Z","last_active_at":"2026-09-29T19:01:32.281Z","remembered":false,"client_ids":["ops-app"]},{"id":"01a0ee8b-28f4-79df-bbe5-95698666977b","subject_id":"01a0ee8a-c748-743d-b60e-9b0ed48221a3","username":"linus","created_at":"2026-09-29T19:01:32.530Z","last_active_at":"2026-09-29T19:01:32.530Z","remembered":false,"client_ids":["ops-app"]}]}`;
const SESSION_COUNT = '{"count":2,"capped":false}';
const GRANTS = '{"revoked":1,"beyond_ceiling":1,"remaining":0}';
const DELIVERIES = `{"items":[{"id":"01a0ee8c-5536-7104-abd0-6c8afe2c2850","session_id":"01a0ee8b-28f4-79df-bbe5-95698666977b","endpoint":"https://postgres:9/backchannel","status":"pending","attempts":1,"last_error":"connect ECONNREFUSED 172.22.0.2:9","created_at":"2026-09-29T19:02:49.371Z","next_attempt_at":"2026-09-29T19:03:50.227Z","delivered_at":null},{"id":"01a0ee8c-552f-7614-bf53-93c13eeca916","session_id":"01a0ee8b-27fa-7271-bb21-8bf1dec2d0fa","endpoint":"https://postgres:9/backchannel","status":"pending","attempts":1,"last_error":"connect ECONNREFUSED 172.22.0.2:9","created_at":"2026-09-29T19:02:49.371Z","next_attempt_at":"2026-09-29T19:03:50.227Z","delivered_at":null}]}`;
const INSTALLATION = `{"issuer":"http://localhost:3082/tenants/ops-demo","discovery_url":"http://localhost:3082/tenants/ops-demo/.well-known/openid-configuration","client_id":"ops-app","client_type":"confidential","token_endpoint_auth_method":"client_secret_basic","redirect_uris":["https://app.example/callback"],"post_logout_redirect_uris":[],"grant_types":["authorization_code","refresh_token"],"default_scope":"openid profile email address phone roles groups"}`;
const EVALUATION = `{"scope":"openid profile email roles","id_token":{"sub":"01a0ee8a-c58a-716c-96a6-edcab4ca1a70","name":"Grace Hopper","given_name":"Grace","family_name":"Hopper","preferred_username":"grace","updated_at":1790708493,"email":"grace@navy.example","email_verified":false},"access_token":{},"userinfo":{"sub":"01a0ee8a-c58a-716c-96a6-edcab4ca1a70","name":"Grace Hopper","given_name":"Grace","family_name":"Hopper","preferred_username":"grace","updated_at":1790708493,"email":"grace@navy.example","email_verified":false}}`;

it("reads a client's sessions and counts the ones holding a grant through it", async () => {
  const fake = fakeTransport({
    [`GET ${C}/${ID}/sessions`]: served(SESSIONS),
    [`GET ${ACME_ADMIN}/sessions/count`]: served(SESSION_COUNT),
  });
  const { gateway } = fake.transport;
  expect(
    await readClientSessions(gateway, 'acme', ID, new URLSearchParams({ limit: '2' })),
  ).toMatchObject({
    ok: true,
    data: { items: [{ username: 'grace', client_ids: ['ops-app'] }, { username: 'linus' }] },
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
  const fake = fakeTransport({ [`DELETE ${C}/${ID}/grants`]: served(GRANTS) });
  expect(await revokeClientGrants(fake.transport.gateway, 'acme', ID)).toMatchObject({
    ok: true,
    data: { revoked: 1, beyond_ceiling: 1, remaining: 0 },
  });
  expect(fake.sent.at(-1)).toMatchObject({
    method: 'DELETE',
    path: `${C}/${ID}/grants`,
    body: undefined,
  });
});

it('reads the logout deliveries queued for a client, narrowed by the query it is given', async () => {
  const fake = fakeTransport({ [`GET ${C}/${ID}/logout-deliveries`]: served(DELIVERIES) });
  const query = new URLSearchParams({ status: 'pending' });
  expect(await readLogoutDeliveries(fake.transport.gateway, 'acme', ID, query)).toMatchObject({
    ok: true,
    data: { items: [{ status: 'pending', attempts: 1 }, { status: 'pending' }] },
  });
  expect(fake.sent.at(-1)).toMatchObject({
    method: 'GET',
    path: `${C}/${ID}/logout-deliveries`,
  });
  expect(fake.sent.at(-1)?.search.get('status')).toBe('pending');
});

it('reads what a relying party is configured with', async () => {
  const fake = fakeTransport({ [`GET ${C}/${ID}/installation`]: served(INSTALLATION) });
  expect(await readInstallation(fake.transport.gateway, 'acme', ID)).toMatchObject({
    ok: true,
    data: { client_id: 'ops-app', client_type: 'confidential' },
  });
  expect(fake.sent.at(-1)).toMatchObject({ method: 'GET', path: `${C}/${ID}/installation` });
});

it('evaluates the claims for a subject, sending the scope only when one is named', async () => {
  const fake = fakeTransport({ [`GET ${C}/${ID}/evaluate`]: served(EVALUATION) });
  const { gateway } = fake.transport;
  expect(
    await evaluateClaims(gateway, 'acme', ID, {
      subject: SUBJECT,
      scope: ' openid profile email roles ',
    }),
  ).toMatchObject({ ok: true, data: { scope: 'openid profile email roles', access_token: {} } });
  expect(fake.sent.at(-1)).toMatchObject({ method: 'GET', path: `${C}/${ID}/evaluate` });
  expect(fake.sent.at(-1)?.search.get('subject')).toBe(SUBJECT);
  expect(fake.sent.at(-1)?.search.get('scope')).toBe('openid profile email roles');
  await evaluateClaims(gateway, 'acme', ID, { subject: SUBJECT, scope: '  ' });
  expect(fake.sent.at(-1)?.search.has('scope')).toBe(false);
});
