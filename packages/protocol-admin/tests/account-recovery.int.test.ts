import { actionTokenRepository } from '@odudu/account';
import { requiredActionRepository } from '@odudu/authn-flows';
import { withTenant } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { loginFailureRepository, subjectRepository } from '@odudu/domain-identity';
import { TENANT_CAPABILITIES } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import {
  createPasswordSubject,
  createSignInClient,
  signInForRefreshToken,
  submitPassword,
} from '#/testing/sign-in';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const PASSWORD = 'correct horse battery staple';

async function issuePassword(
  tenantName: string,
  subjectId: string,
  capabilities: readonly string[] = ['manage-users'],
): Promise<{ statusCode: number; body: string; password: string | undefined }> {
  const token = await fixture.adminToken(tenantName, capabilities);
  const res = await fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenantName}/subjects/${subjectId}/password`,
    headers: { authorization: `Bearer ${token}` },
  });
  const password = res.statusCode === 201 ? res.json<{ password: string }>().password : undefined;
  return { statusCode: res.statusCode, body: res.body, password };
}

describe('POST /admin/tenants/{t}/subjects/{id}/password', () => {
  it('answers 201 with a password that signs in and parks on the forced change', async () => {
    const t = await fixture.createTenant(`otp-${newId()}`);
    const client = await createSignInClient(fixture, t.id);
    const username = `ada-${newId()}`;
    const subjectId = await createPasswordSubject(fixture, t.id, username, PASSWORD);

    const issued = await issuePassword(t.name, subjectId);
    expect(issued.statusCode).toBe(201);
    expect(Object.keys(JSON.parse(issued.body) as object)).toEqual(['password']);
    const password = issued.password ?? '';
    expect(password).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const login = await submitPassword(fixture, t.name, client.clientId, username, password);
    expect(login.statusCode).toBe(200);
    expect(login.body).toContain('Change your password');
    expect(login.body).toContain('action=update-password');
  });

  it('replaces the password the subject had, so the old one stops working', async () => {
    const t = await fixture.createTenant(`otp-replace-${newId()}`);
    const client = await createSignInClient(fixture, t.id);
    const username = `bea-${newId()}`;
    const subjectId = await createPasswordSubject(fixture, t.id, username, PASSWORD);

    expect((await issuePassword(t.name, subjectId)).statusCode).toBe(201);

    const old = await submitPassword(fixture, t.name, client.clientId, username, PASSWORD);
    expect(old.statusCode).not.toBe(302);
    expect(old.body).not.toContain('Change your password');
  });

  it('gives a subject with no password credential one', async () => {
    const t = await fixture.createTenant(`otp-none-${newId()}`);
    const client = await createSignInClient(fixture, t.id);
    const username = `cy-${newId()}`;
    const { id: subjectId } = await fixture.createSubject(t.name, username);

    const issued = await issuePassword(t.name, subjectId);
    expect(issued.statusCode).toBe(201);

    const login = await submitPassword(
      fixture,
      t.name,
      client.clientId,
      username,
      issued.password ?? '',
    );
    expect(login.body).toContain('Change your password');
  });

  it('owes update-password', async () => {
    const t = await fixture.createTenant(`otp-action-${newId()}`);
    const { id: subjectId } = await fixture.createSubject(t.name, `di-${newId()}`);

    expect((await issuePassword(t.name, subjectId)).statusCode).toBe(201);

    const actions = await withTenant(fixture.app.db, t.id, (tx) =>
      requiredActionRepository(tx).pendingFor(subjectId),
    );
    expect(actions).toContain('update-password');
  });

  it('leaves a session the subject already holds alive, as a password reset does', async () => {
    const t = await fixture.createTenant(`otp-session-${newId()}`);
    const client = await createSignInClient(fixture, t.id);
    const username = `eve-${newId()}`;
    const subjectId = await createPasswordSubject(fixture, t.id, username, PASSWORD);
    await signInForRefreshToken(fixture, t.name, client, username, PASSWORD);

    expect((await issuePassword(t.name, subjectId)).statusCode).toBe(201);

    const token = await fixture.adminToken(t.name, ['manage-sessions']);
    const listed = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${subjectId}/sessions`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listed.json<{ items: unknown[] }>().items).toHaveLength(1);
  });

  it('writes subject.password_issue with an empty detail, and the password nowhere in the audit log', async () => {
    const t = await fixture.createTenant(`otp-audit-${newId()}`);
    const { id: subjectId } = await fixture.createSubject(t.name, `fay-${newId()}`);

    const issued = await issuePassword(t.name, subjectId);
    const password = issued.password ?? '';
    expect(password).not.toBe('');

    const rows = await withTenant(fixture.app.db, t.id, (tx) =>
      auditRepository(tx).list({ limit: 50 }),
    );
    const issue = rows.filter((row) => row.action === 'subject.password_issue');
    expect(issue).toHaveLength(1);
    expect(issue[0]).toMatchObject({
      eventType: 'admin_mutation',
      outcome: 'allowed',
      resourceType: 'subject',
      resourceId: subjectId,
    });
    expect(issue[0]?.detail ?? {}).toEqual({});

    // Every column of every audit row, in every tenant, as text.
    const leaked = await fixture.owner.db.execute(
      sql`SELECT count(*)::int AS n FROM audit_events AS a WHERE a::text LIKE ${`%${password}%`}`,
    );
    expect((leaked as unknown as { n: number }[])[0]?.n).toBe(0);
  });

  it('clears a lockout, so the issued password signs in at once', async () => {
    const t = await fixture.createTenant(`otp-locked-${newId()}`);
    const client = await createSignInClient(fixture, t.id);
    const username = `ian-${newId()}`;
    const subjectId = await createPasswordSubject(fixture, t.id, username, PASSWORD);
    await lockOut(t.name, client.clientId, username);

    const issued = await issuePassword(t.name, subjectId);
    expect(issued.statusCode).toBe(201);

    const login = await submitPassword(
      fixture,
      t.name,
      client.clientId,
      username,
      issued.password ?? '',
    );
    expect(login.body).toContain('Change your password');
  });

  it('retires every outstanding reset-password link', async () => {
    const t = await fixture.createTenant(`otp-links-${newId()}`);
    const { id: subjectId } = await fixture.createSubject(t.name, `jo-${newId()}`);
    const { token: link } = await withTenant(fixture.app.db, t.id, (tx) =>
      actionTokenRepository(tx).issue({
        tenantId: t.id,
        subjectId,
        type: 'reset_password',
        email: 'jo@example.test',
        ttlSeconds: 3600,
      }),
    );

    expect((await issuePassword(t.name, subjectId)).statusCode).toBe(201);

    const peeked = await withTenant(fixture.app.db, t.id, (tx) =>
      actionTokenRepository(tx).peek(link),
    );
    expect(peeked).toBeNull();
  });

  it('answers 404 for a service subject, which has no password to sign in with', async () => {
    const t = await fixture.createTenant(`otp-service-${newId()}`);
    const serviceId = await withTenant(fixture.app.db, t.id, async (tx) => {
      const subject = await subjectRepository(tx).create({ tenantId: t.id, type: 'service' });
      return subject.id;
    });

    expect((await issuePassword(t.name, serviceId)).statusCode).toBe(404);
  });

  it('answers 404 for an unknown subject, and for another tenant’s', async () => {
    const t = await fixture.createTenant(`otp-404-${newId()}`);
    const u = await fixture.createTenant(`otp-foreign-${newId()}`);
    const { id: foreignId } = await fixture.createSubject(u.name, `gus-${newId()}`);

    expect((await issuePassword(t.name, newId())).statusCode).toBe(404);
    expect((await issuePassword(t.name, foreignId)).statusCode).toBe(404);

    const actions = await withTenant(fixture.app.db, u.id, (tx) =>
      requiredActionRepository(tx).pendingFor(foreignId),
    );
    expect(actions).toEqual([]);
  });

  it.each(TENANT_CAPABILITIES.filter((c) => c !== 'manage-users'))(
    'refuses a caller holding only %s',
    async (capability) => {
      const t = await fixture.createTenant(`otp-403-${newId()}`);
      const { id: subjectId } = await fixture.createSubject(t.name, `hal-${newId()}`);
      expect((await issuePassword(t.name, subjectId, [capability])).statusCode).toBe(403);
    },
  );
});

async function lockOut(tenantName: string, clientId: string, username: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await submitPassword(fixture, tenantName, clientId, username, 'wrong password');
  }
  const refused = await submitPassword(fixture, tenantName, clientId, username, PASSWORD);
  expect(refused.statusCode).not.toBe(302);
}

async function clearLockout(
  tenantName: string,
  subjectId: string,
  capabilities: readonly string[] = ['manage-users'],
): Promise<number> {
  const token = await fixture.adminToken(tenantName, capabilities);
  const res = await fixture.http.inject({
    method: 'DELETE',
    url: `/admin/tenants/${tenantName}/subjects/${subjectId}/lockout`,
    headers: { authorization: `Bearer ${token}` },
  });
  return res.statusCode;
}

describe('DELETE /admin/tenants/{t}/subjects/{id}/lockout', () => {
  it('lets a locked subject sign in immediately', async () => {
    const t = await fixture.createTenant(`unlock-${newId()}`);
    const client = await createSignInClient(fixture, t.id);
    const username = `ida-${newId()}`;
    const subjectId = await createPasswordSubject(fixture, t.id, username, PASSWORD);
    await lockOut(t.name, client.clientId, username);

    expect(await clearLockout(t.name, subjectId)).toBe(204);

    const login = await submitPassword(fixture, t.name, client.clientId, username, PASSWORD);
    expect(login.statusCode).toBe(302);
  });

  it('answers 204 for a subject with nothing against it, and records whether a row went', async () => {
    const t = await fixture.createTenant(`unlock-none-${newId()}`);
    const client = await createSignInClient(fixture, t.id);
    const username = `jan-${newId()}`;
    const subjectId = await createPasswordSubject(fixture, t.id, username, PASSWORD);

    expect(await clearLockout(t.name, subjectId)).toBe(204);
    await lockOut(t.name, client.clientId, username);
    expect(await clearLockout(t.name, subjectId)).toBe(204);

    const rows = await withTenant(fixture.app.db, t.id, (tx) =>
      auditRepository(tx).list({ limit: 50 }),
    );
    const clears = rows
      .filter((row) => row.action === 'subject.lockout_clear')
      .map((row) => ({ resourceId: row.resourceId, detail: row.detail }));
    expect(clears).toHaveLength(2);
    expect(clears).toEqual(
      expect.arrayContaining([
        { resourceId: subjectId, detail: { cleared: false } },
        { resourceId: subjectId, detail: { cleared: true } },
      ]),
    );
  });

  it('answers 404 for a service subject, which has no sign-in to be locked out of', async () => {
    const t = await fixture.createTenant(`unlock-service-${newId()}`);
    const serviceId = await withTenant(fixture.app.db, t.id, async (tx) => {
      const subject = await subjectRepository(tx).create({ tenantId: t.id, type: 'service' });
      return subject.id;
    });

    expect(await clearLockout(t.name, serviceId)).toBe(404);
  });

  it('answers 404 for an unknown subject, and leaves another tenant’s lockout alone', async () => {
    const t = await fixture.createTenant(`unlock-404-${newId()}`);
    const u = await fixture.createTenant(`unlock-foreign-${newId()}`);
    const client = await createSignInClient(fixture, u.id);
    const username = `kai-${newId()}`;
    const foreignId = await createPasswordSubject(fixture, u.id, username, PASSWORD);
    await lockOut(u.name, client.clientId, username);

    expect(await clearLockout(t.name, newId())).toBe(404);
    expect(await clearLockout(t.name, foreignId)).toBe(404);

    const failures = await withTenant(fixture.app.db, u.id, (tx) =>
      loginFailureRepository(tx).forSubject(foreignId),
    );
    expect(failures.lockedUntil).not.toBeNull();
  });

  it.each(TENANT_CAPABILITIES.filter((c) => c !== 'manage-users'))(
    'refuses a caller holding only %s',
    async (capability) => {
      const t = await fixture.createTenant(`unlock-403-${newId()}`);
      const { id: subjectId } = await fixture.createSubject(t.name, `lee-${newId()}`);
      expect(await clearLockout(t.name, subjectId, [capability])).toBe(403);
    },
  );
});
