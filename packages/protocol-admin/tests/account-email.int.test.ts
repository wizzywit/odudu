import { actionTokens } from '@odudu/account';
import { tenants, withTenant } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { roleRepository } from '@odudu/domain-authz';
import { subjectRepository, userRepository } from '@odudu/domain-identity';
import { ADMIN_CLIENT_ID, clientRepository, TENANT_ADMIN } from '@odudu/domain-tenant';
import { emailOutbox } from '@odudu/email';
import { newId } from '@odudu/kernel';
import { eq } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

let relayed: AdminFixture | undefined;
let unrelayed: AdminFixture | undefined;
let fixture: AdminFixture;
let bare: AdminFixture;
beforeAll(async () => {
  relayed = await startAdminFixture({ deploymentSmtp: true });
  unrelayed = await startAdminFixture();
  fixture = relayed;
  bare = unrelayed;
}, 240_000);
afterAll(async () => {
  await relayed?.stop();
  await unrelayed?.stop();
});

async function seedUser(
  on: AdminFixture,
  tenantId: string,
  username: string,
  email: string | null,
): Promise<string> {
  return withTenant(on.app.db, tenantId, async (tx) => {
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await userRepository(tx).create({ subjectId: subject.id, tenantId, username, email });
    return subject.id;
  });
}

async function allowReset(on: AdminFixture, tenantId: string): Promise<void> {
  await on.owner.db
    .update(tenants)
    .set({ resetPasswordAllowed: true })
    .where(eq(tenants.id, tenantId));
}

function post(
  on: AdminFixture,
  tenantName: string,
  token: string,
  tail: string,
): Promise<LightMyRequestResponse> {
  return on.http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenantName}/subjects/${tail}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

async function outboxOf(on: AdminFixture, tenantId: string) {
  return withTenant(on.app.db, tenantId, (tx) => tx.select().from(emailOutbox));
}

describe('POST /subjects/:id/password-reset', () => {
  it('queues the reset link a self-service request sends, and never answers or audits it', async () => {
    const t = await fixture.createTenant(`mail-${newId()}`);
    await allowReset(fixture, t.id);
    const ada = await seedUser(fixture, t.id, 'ada', 'ada@example.com');
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await post(fixture, t.name, token, `${ada}/password-reset`);
    expect(res.statusCode).toBe(202);
    expect(res.body).toBe('');

    const queued = await outboxOf(fixture, t.id);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.toAddress).toBe('ada@example.com');
    expect(queued[0]?.bodyText).toContain('/login-actions/action-token?key=');
    const issued = await withTenant(fixture.app.db, t.id, (tx) =>
      tx.select().from(actionTokens).where(eq(actionTokens.subjectId, ada)),
    );
    expect(issued.map((row) => row.type)).toEqual(['reset_password']);

    const rows = await withTenant(fixture.app.db, t.id, (tx) =>
      auditRepository(tx).list({ action: 'subject.password_reset_send', limit: 5 }),
    );
    expect(rows[0]).toMatchObject({ outcome: 'allowed', resourceId: ada });
    expect(JSON.stringify(rows[0]?.detail)).not.toContain('key=');
  });

  it('answers 409 no-email for a subject with no address, and queues nothing', async () => {
    const t = await fixture.createTenant(`mail-${newId()}`);
    await allowReset(fixture, t.id);
    const ada = await seedUser(fixture, t.id, 'ada', null);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const res = await post(fixture, t.name, token, `${ada}/password-reset`);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ type: string }>().type).toBe('about:blank#no-email');
    expect(await outboxOf(fixture, t.id)).toEqual([]);
  });

  it('answers 409 reset-password-off while the tenant would refuse the link', async () => {
    const t = await fixture.createTenant(`mail-${newId()}`);
    const ada = await seedUser(fixture, t.id, 'ada', 'ada@example.com');
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const res = await post(fixture, t.name, token, `${ada}/password-reset`);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ type: string }>().type).toBe('about:blank#reset-password-off');
  });

  it('answers 409 no-mail-relay when the tenant’s mail would only be logged', async () => {
    const t = await bare.createTenant(`mail-${newId()}`);
    await allowReset(bare, t.id);
    const ada = await seedUser(bare, t.id, 'ada', 'ada@example.com');
    const token = await bare.adminToken(t.name, ['manage-users']);
    const res = await post(bare, t.name, token, `${ada}/password-reset`);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ type: string }>().type).toBe('about:blank#no-mail-relay');
  });

  it('refuses a caller below the subject’s capabilities, and 404s an unknown id', async () => {
    const t = await fixture.createTenant(`mail-${newId()}`);
    await allowReset(fixture, t.id);
    const root = await seedUser(fixture, t.id, 'root', 'root@example.com');
    await withTenant(fixture.app.db, t.id, async (tx) => {
      const admin = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
      const role = await roleRepository(tx).byName(TENANT_ADMIN, admin?.id ?? '');
      await roleRepository(tx).assignToSubject(root, role?.id ?? '');
    });
    const token = await fixture.adminToken(t.name, ['manage-users']);
    expect((await post(fixture, t.name, token, `${root}/password-reset`)).statusCode).toBe(403);
    expect((await post(fixture, t.name, token, `${newId()}/password-reset`)).statusCode).toBe(404);
    expect(await outboxOf(fixture, t.id)).toEqual([]);
  });
});

describe('POST /subjects/:id/verification', () => {
  it('queues a fresh verification link to the subject’s address', async () => {
    const t = await fixture.createTenant(`mail-${newId()}`);
    const ada = await seedUser(fixture, t.id, 'ada', 'ada@example.com');
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await post(fixture, t.name, token, `${ada}/verification`);
    expect(res.statusCode).toBe(202);
    const queued = await outboxOf(fixture, t.id);
    expect(queued.map((row) => row.toAddress)).toEqual(['ada@example.com']);
    const issued = await withTenant(fixture.app.db, t.id, (tx) =>
      tx.select().from(actionTokens).where(eq(actionTokens.subjectId, ada)),
    );
    expect(issued.map((row) => row.type)).toEqual(['verify_email']);
  });

  it('answers 409 no-email and no-mail-relay as the reset does, and needs manage-users', async () => {
    const t = await fixture.createTenant(`mail-${newId()}`);
    const nomail = await seedUser(fixture, t.id, 'nomail', null);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const res = await post(fixture, t.name, token, `${nomail}/verification`);
    expect(res.json<{ type: string }>().type).toBe('about:blank#no-email');

    const b = await bare.createTenant(`mail-${newId()}`);
    const ada = await seedUser(bare, b.id, 'ada', 'ada@example.com');
    const bareToken = await bare.adminToken(b.name, ['manage-users']);
    const relay = await post(bare, b.name, bareToken, `${ada}/verification`);
    expect(relay.json<{ type: string }>().type).toBe('about:blank#no-mail-relay');

    const reader = await fixture.adminToken(t.name, ['view-users']);
    expect((await post(fixture, t.name, reader, `${nomail}/verification`)).statusCode).toBe(403);
  });
});
