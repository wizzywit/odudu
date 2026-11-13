import { expect, it } from 'vitest';
import consents from '#/pages/subjects/adapter/fixtures/consents.json';
import grants from '#/pages/subjects/adapter/fixtures/grants.json';
import revoked from '#/pages/subjects/adapter/fixtures/revoked-grants.json';
import sessions from '#/pages/subjects/adapter/fixtures/sessions.json';
import {
  endAllSessions,
  endSession,
  readConsents,
  readGrants,
  readSessions,
  revokeConsent,
  revokeGrants,
} from '#/pages/subjects/adapter/sessions';
import { fakeTransport, json } from '#/testing/fakeTransport';
import { noContent } from '#/testing/subjectsFixtures';

const S = '/console/api/admin/tenants/acme/subjects/s1';

it('lists sessions as domain sessions a page at a time, and ends one or all', async () => {
  const fake = fakeTransport({
    [`GET ${S}/sessions`]: json(sessions),
    [`DELETE ${S}/sessions/x1`]: noContent(),
    [`DELETE ${S}/sessions`]: json({ ended: 2 }),
  });
  const gateway = fake.transport.gateway;
  const page = await readSessions(gateway, 'acme', 's1', new URLSearchParams({ cursor: 'c1' }));
  expect(fake.sent[0]?.search.toString()).toBe('cursor=c1');
  expect(page.ok && page.data.items).toEqual([
    {
      id: '01a0d6fe-9d8f-783b-b244-ea4a85ab9bfb',
      createdAt: '2026-09-25T05:16:45.837Z',
      lastActiveAt: '2026-09-25T05:16:45.837Z',
      remembered: false,
      clientIds: ['demo-app'],
      device: '3f1c7a9e5b2d4c68a0e91f37d5b84c2a6e7f90b1d3c5a8e2f4b6d7091a3c5e8f',
    },
  ]);
  expect(await endSession(gateway, 'acme', 's1', 'x1')).toMatchObject({ ok: true });
  expect(await endAllSessions(gateway, 'acme', 's1')).toMatchObject({ data: { ended: 2 } });
});

it('lists consents as domain consents, the cursor on, and revokes one by the client row id', async () => {
  const fake = fakeTransport({
    [`GET ${S}/consents`]: json(consents),
    [`DELETE ${S}/consents/c1`]: noContent(),
  });
  const page = await readConsents(fake.transport.gateway, 'acme', 's1', new URLSearchParams());
  expect(page.ok && page.data.next).toBe(consents.next);
  expect(page.ok && page.data.items[0]).toEqual({
    clientId: '01a10f7d-edbc-792a-b693-f9abee8b7a7e',
    clientKey: 'alpha-app',
    scopeNames: ['openid'],
    grantedAt: '2026-10-06T04:34:33.829Z',
  });
  expect(await revokeConsent(fake.transport.gateway, 'acme', 's1', 'c1')).toMatchObject({
    ok: true,
  });
});

it("lists grants as domain grants, and revokes a client's", async () => {
  const fake = fakeTransport({
    [`GET ${S}/grants`]: json(grants),
    [`DELETE ${S}/grants/c1`]: json(revoked),
  });
  const page = await readGrants(fake.transport.gateway, 'acme', 's1', new URLSearchParams());
  expect(page.ok && page.data.items).toHaveLength(2);
  expect(page.ok && page.data.items[0]).toEqual({
    id: '01a0ee8b-2736-7d56-a78d-5d0c22330e0b',
    clientId: '01a0ee8a-d1a7-7c3c-a05b-903a2d8fa123',
    clientKey: 'ops-app',
    scope: 'openid profile email offline_access',
    createdAt: '2026-09-29T19:01:32.013Z',
    sessionId: null,
    offline: true,
    refreshExpiresAt: '2026-10-13T19:01:32.073Z',
  });
  expect(await revokeGrants(fake.transport.gateway, 'acme', 's1', 'c1')).toMatchObject({
    data: { revoked: 2 },
  });
});
