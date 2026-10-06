import { expect, it } from 'vitest';
import {
  endAllSessions,
  endSession,
  readConsents,
  readGrants,
  readSessions,
  revokeConsent,
  revokeGrants,
} from '#/features/subjects/adapter/sessions.ts';
import { noContent } from '#/testing/subjectsFixtures.ts';
import { fakeTransport, json } from '#/testing/fakeTransport.ts';

const S = '/console/api/admin/tenants/acme/subjects/s1';
const SESSION = {
  id: 'x1',
  created_at: '2026-09-28T08:41:53.858Z',
  last_active_at: '2026-09-28T09:41:53.858Z',
  remembered: false,
  client_ids: ['app'],
};

it('lists sessions a page at a time, and ends one or all', async () => {
  const fake = fakeTransport({
    [`GET ${S}/sessions`]: json({ items: [SESSION], next: 'c2' }),
    [`DELETE ${S}/sessions/x1`]: noContent(),
    [`DELETE ${S}/sessions`]: json({ ended: 2 }),
  });
  const gateway = fake.transport.gateway;
  expect(
    await readSessions(gateway, 'acme', 's1', new URLSearchParams({ cursor: 'c1' })),
  ).toMatchObject({ ok: true, data: { items: [SESSION], next: 'c2' } });
  expect(fake.sent[0]?.search.toString()).toBe('cursor=c1');
  expect(await endSession(gateway, 'acme', 's1', 'x1')).toMatchObject({ ok: true });
  expect(await endAllSessions(gateway, 'acme', 's1')).toMatchObject({ data: { ended: 2 } });
});

it('lists consents and revokes one by the client row id', async () => {
  const consent = {
    client_id: 'c1',
    client_key: 'app',
    scope_names: ['openid'],
    granted_at: '2026-09-28T08:41:53.858Z',
  };
  const fake = fakeTransport({
    [`GET ${S}/consents`]: json({ items: [consent] }),
    [`DELETE ${S}/consents/c1`]: noContent(),
  });
  expect(
    await readConsents(fake.transport.gateway, 'acme', 's1', new URLSearchParams()),
  ).toMatchObject({
    data: { items: [consent] },
  });
  expect(await revokeConsent(fake.transport.gateway, 'acme', 's1', 'c1')).toMatchObject({
    ok: true,
  });
});

it("lists grants a page at a time, and revokes a client's", async () => {
  const grant = {
    id: 'g1',
    client_id: 'c1',
    client_key: 'app',
    scope: 'openid offline_access',
    created_at: '2026-09-28T08:41:53.858Z',
    session_id: null,
    offline: true,
    refresh_expires_at: null,
  };
  const fake = fakeTransport({
    [`GET ${S}/grants`]: json({ items: [grant] }),
    [`DELETE ${S}/grants/c1`]: json({ revoked: 1 }),
  });
  expect(
    await readGrants(fake.transport.gateway, 'acme', 's1', new URLSearchParams()),
  ).toMatchObject({ data: { items: [grant] } });
  expect(await revokeGrants(fake.transport.gateway, 'acme', 's1', 'c1')).toMatchObject({
    data: { revoked: 1 },
  });
});
