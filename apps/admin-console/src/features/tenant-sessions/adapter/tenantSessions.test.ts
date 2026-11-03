import { expect, it } from 'vitest';
import endSessions from '#/features/tenant-sessions/adapter/fixtures/end-sessions.json';
import sessionList from '#/features/tenant-sessions/adapter/fixtures/session-list.json';
import {
  endTenantSessions,
  readTenantSessionPage,
} from '#/features/tenant-sessions/adapter/tenantSessions';
import type { GatewayResult } from '#/shared/transport/gateway';
import { fakeTransport, json } from '#/testing/fakeTransport';

function dataOf<T>(result: GatewayResult<T>): T | undefined {
  return result.ok ? result.data : undefined;
}

it('reads one page of the tenant’s sessions with the cursor it is given', async () => {
  const fake = fakeTransport({
    'GET /console/api/admin/tenants/acme/sessions': json(sessionList),
  });
  const query = new URLSearchParams({ cursor: 'c1' });
  const page = dataOf(await readTenantSessionPage(fake.transport.gateway, 'acme', query));
  expect(page).toEqual({
    items: [
      {
        id: '01a0ee8b-26ae-74b4-8598-c6ca2545c92f',
        subjectId: '01a0ee8a-c58a-716c-96a6-edcab4ca1a70',
        username: 'grace',
        createdAt: '2026-09-29T19:01:31.945Z',
        lastActiveAt: '2026-09-29T19:01:31.945Z',
        remembered: false,
        clientIds: [],
      },
      {
        id: '01a0ee8b-27fa-7271-bb21-8bf1dec2d0fa',
        subjectId: '01a0ee8a-c58a-716c-96a6-edcab4ca1a70',
        username: 'grace',
        createdAt: '2026-09-29T19:01:32.281Z',
        lastActiveAt: '2026-09-29T19:01:32.281Z',
        remembered: false,
        clientIds: ['ops-app'],
      },
    ],
    next: sessionList.next,
  });
  expect(fake.sent.map((sent) => sent.search.toString())).toEqual(['cursor=c1']);
});

it('refuses an answer that names no subject', async () => {
  const bare = { ...sessionList.items[0], subject_id: undefined };
  const fake = fakeTransport({
    'GET /console/api/admin/tenants/acme/sessions': json({ items: [bare] }),
  });
  expect(
    await readTenantSessionPage(fake.transport.gateway, 'acme', new URLSearchParams()),
  ).toMatchObject({ ok: false, kind: 'schema' });
});

it('ends every session in the tenant and reads the three counts it answers with', async () => {
  const fake = fakeTransport({
    'DELETE /console/api/admin/tenants/acme/sessions': json(endSessions),
  });
  expect(dataOf(await endTenantSessions(fake.transport.gateway, 'acme'))).toEqual({
    ended: 4,
    remaining: 0,
    beyondCeiling: 1,
  });
  expect(fake.sent.map((sent) => sent.method)).toEqual(['DELETE']);
});
