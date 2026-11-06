import { randomUUID } from 'node:crypto';
import { createDatabase } from '@odudu/db';
import { TENANT_CAPABILITIES } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from '#/service/capability';
import { idempotentMethod } from '#/service/idempotency';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

interface Seen {
  readonly query: string;
  readonly connection: number;
}
const seen: Seen[] = [];

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture({
    openApp: (url) =>
      createDatabase(url, {
        max: 5,
        onQueryForTests: (query, _parameters, connection) => {
          seen.push({ query, connection });
        },
      }),
  });
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

interface Drive {
  readonly body?: unknown;
  readonly raw?: { readonly type: string; readonly bytes: Buffer };
}

// What each POST is sent, so its handler is reached. The id segments are
// filled in by the test.
const DRIVES: Record<string, Drive> = {
  '/admin/tenants/:tenant/subjects': { body: { username: 'drive-user' } },
  '/admin/tenants/:tenant/subjects/bulk': { body: { action: 'disable', ids: [randomUUID()] } },
  '/admin/tenants/:tenant/subjects/:id/password-reset': {},
  '/admin/tenants/:tenant/subjects/:id/verification': {},
  '/admin/tenants/:tenant/subjects/:id/actions-email': { body: { actions: ['update-password'] } },
  '/admin/tenants/:tenant/theme/publish': {},
  '/admin/tenants/:tenant/theme/versions/:versionId/restore': {},
  '/admin/tenants/:tenant/theme/assets': {
    raw: { type: 'image/png', bytes: Buffer.from('not an image') },
  },
  '/admin/tenants/:tenant/clients/:id/theme/publish': {},
  '/admin/tenants/:tenant/clients/:id/theme/versions/:versionId/restore': {},
  '/admin/tenants/:tenant/domains': { body: { host: 'drive.example.com' } },
  '/admin/tenants/:tenant/domains/:id/verify': {},
  '/admin/tenants/:tenant/domains/:id/activate': {},
  '/admin/tenants/:tenant/domains/:id/deactivate': {},
  '/admin/tenants/:tenant/roles': { body: { name: 'drive-role' } },
  '/admin/tenants/:tenant/roles/:id/composites': { body: { child_role_id: randomUUID() } },
  '/admin/tenants/:tenant/groups': { body: { name: 'drive-group' } },
  '/admin/tenants/:tenant/scopes': { body: { name: 'drive-scope' } },
  '/admin/tenants/:tenant/scopes/restore-builtins': {},
  '/admin/tenants/:tenant/keys': { body: { alg: 'RS256' } },
  '/admin/tenants/:tenant/keys/:id/promote': {},
  '/admin/tenants/:tenant/keys/:id/retire': {},
  '/admin/tenants/:tenant/smtp/test': { body: { to: 'drive@example.com' } },
};

// Statements that write state other than the audit trail.
const WRITES = /^\s*(insert into|update|delete from)\s+"?(?!audit_events)/iu;

function url(pattern: string, tenant: string, subjectId: string): string {
  return pattern
    .replace(':tenant', tenant)
    .replace('/subjects/:id', `/subjects/${subjectId}`)
    .replace(':id', randomUUID())
    .replace(':versionId', randomUUID())
    .concat(pattern.endsWith('/theme/assets') ? '?kind=logo' : '');
}

function send(
  pattern: string,
  tenant: string,
  token: string,
  subjectId: string,
): Promise<LightMyRequestResponse> {
  const drive = DRIVES[pattern] ?? {};
  const raw = drive.raw;
  return fixture.http.inject({
    method: 'POST',
    url: url(pattern, tenant, subjectId),
    headers: {
      authorization: `Bearer ${token}`,
      'idempotency-key': `k-${newId()}`,
      ...(raw !== undefined
        ? { 'content-type': raw.type }
        : drive.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
    },
    ...(raw !== undefined
      ? { payload: raw.bytes }
      : drive.body === undefined
        ? {}
        : { payload: JSON.stringify(drive.body) }),
  });
}

const accepting = ADMIN_ROUTES.filter(
  (route) => idempotentMethod(route.method) && route.noIdempotency === undefined,
);

describe('every POST that takes an Idempotency-Key', () => {
  it('has a request that reaches its handler', () => {
    expect(accepting.map((route) => route.pattern).sort()).toEqual(Object.keys(DRIVES).sort());
  });

  it.each(accepting.map((route) => route.pattern))(
    'writes only through the transaction its record shares: %s',
    async (pattern) => {
      const t = await fixture.createTenant(`join-${newId()}`);
      const token = await fixture.adminToken(t.name, [...TENANT_CAPABILITIES]);
      const subject = await fixture.createSubject(t.name, `s-${newId()}`);
      const from = seen.length;
      const res = await send(pattern, t.name, token, subject.id);
      const statements = seen.slice(from);
      const lock = statements.findIndex((entry) =>
        entry.query.includes('pg_try_advisory_xact_lock'),
      );
      expect(
        lock,
        `${pattern} answered ${String(res.statusCode)} before its key was read`,
      ).toBeGreaterThan(-1);
      const held = statements[lock]?.connection;
      const outside = statements
        .slice(lock)
        .filter((entry) => WRITES.test(entry.query) && entry.connection !== held)
        .map((entry) => entry.query.slice(0, 80));
      expect(outside).toEqual([]);
    },
    60_000,
  );
});
