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

const REDIRECT = 'https://app.example/callback';

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

async function send(
  on: AdminFixture,
  tenantName: string,
  subjectId: string,
  body: Record<string, unknown>,
  capabilities: readonly string[] = ['manage-users'],
): Promise<LightMyRequestResponse> {
  const token = await on.adminToken(tenantName, [...capabilities]);
  return on.http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenantName}/subjects/${subjectId}/actions-email`,
    headers: { authorization: `Bearer ${token}` },
    payload: body,
  });
}

async function outboxOf(on: AdminFixture, tenantId: string) {
  return withTenant(on.app.db, tenantId, (tx) => tx.select().from(emailOutbox));
}

async function tokensOf(on: AdminFixture, tenantId: string, subjectId: string) {
  return withTenant(on.app.db, tenantId, (tx) =>
    tx.select().from(actionTokens).where(eq(actionTokens.subjectId, subjectId)),
  );
}

async function clientWithRedirect(tenantName: string): Promise<string> {
  const token = await fixture.adminToken(tenantName, ['manage-clients']);
  const res = await fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenantName}/clients`,
    headers: { authorization: `Bearer ${token}` },
    payload: { client_id: `app-${newId()}`, redirect_uris: [REDIRECT] },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ client_id: string }>().client_id;
}

describe('POST /subjects/:id/actions-email', () => {
  it('queues one link naming the actions, and never answers or audits the link', async () => {
    const t = await fixture.createTenant(`act-${newId()}`);
    await allowReset(fixture, t.id);
    const ada = await seedUser(fixture, t.id, 'ada', 'ada@example.com');
    const clientId = await clientWithRedirect(t.name);

    const res = await send(fixture, t.name, ada, {
      actions: ['configure-totp', 'update-password', 'configure-totp'],
      client_id: clientId,
      redirect_uri: REDIRECT,
    });
    expect(res.statusCode, res.body).toBe(202);
    expect(res.body).toBe('');

    const queued = await outboxOf(fixture, t.id);
    expect(queued.map((row) => row.toAddress)).toEqual(['ada@example.com']);
    expect(queued[0]?.bodyText).toContain('/login-actions/action-token?key=');
    expect(queued[0]?.bodyText).toContain('Choose a new password');
    expect(queued[0]?.bodyText).toContain('Set up an authenticator app');
    const issued = await tokensOf(fixture, t.id, ada);
    expect(issued.map((row) => [row.type, row.actions, row.redirectUri])).toEqual([
      ['execute_actions', ['update-password', 'configure-totp'], REDIRECT],
    ]);

    const rows = await withTenant(fixture.app.db, t.id, (tx) =>
      auditRepository(tx).list({ action: 'subject.actions_email_send', limit: 5 }),
    );
    expect(rows.map((row) => ({ outcome: row.outcome, detail: row.detail }))).toEqual([
      {
        outcome: 'allowed',
        detail: {
          actions: ['update-password', 'configure-totp'],
          client_id: clientId,
          redirect_uri: REDIRECT,
        },
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain('key=');
  });

  it('needs no reset setting when no password is asked for, nor a redirect', async () => {
    const t = await fixture.createTenant(`act-${newId()}`);
    const ada = await seedUser(fixture, t.id, 'ada', 'ada@example.com');
    const res = await send(fixture, t.name, ada, { actions: ['configure-passkey'] });
    expect(res.statusCode, res.body).toBe(202);
    const issued = await tokensOf(fixture, t.id, ada);
    expect(issued.map((row) => [row.actions, row.redirectUri])).toEqual([
      [['configure-passkey'], null],
    ]);
  });

  it('answers the same 409s the reset does, each queueing nothing', async () => {
    const t = await fixture.createTenant(`act-${newId()}`);
    const nomail = await seedUser(fixture, t.id, 'nomail', null);
    const ada = await seedUser(fixture, t.id, 'ada', 'ada@example.com');
    const noEmail = await send(fixture, t.name, nomail, { actions: ['configure-totp'] });
    expect(noEmail.json<{ type: string }>().type).toBe('about:blank#no-email');
    const resetOff = await send(fixture, t.name, ada, { actions: ['update-password'] });
    expect(resetOff.statusCode).toBe(409);
    expect(resetOff.json<{ type: string }>().type).toBe('about:blank#reset-password-off');

    const b = await bare.createTenant(`act-${newId()}`);
    const grace = await seedUser(bare, b.id, 'grace', 'grace@example.com');
    const relay = await send(bare, b.name, grace, { actions: ['configure-totp'] });
    expect(relay.json<{ type: string }>().type).toBe('about:blank#no-mail-relay');
    expect(await outboxOf(fixture, t.id)).toEqual([]);
  });

  it.each([
    ['no action', () => ({ actions: [] }), 'actions'],
    ['an action the server does not support', () => ({ actions: ['verify-email'] }), 'actions'],
    [
      'a redirect_uri with no client_id',
      () => ({ actions: ['configure-totp'], redirect_uri: REDIRECT }),
      'client_id',
    ],
    [
      'a client_id naming no client',
      () => ({ actions: ['configure-totp'], client_id: 'nonesuch', redirect_uri: REDIRECT }),
      'client_id',
    ],
    [
      'a redirect_uri the client never registered',
      (clientId: string) => ({
        actions: ['configure-totp'],
        client_id: clientId,
        redirect_uri: 'https://evil.example/cb',
      }),
      'redirect_uri',
    ],
  ])('refuses %s with 400 naming the field', async (_label, bodyFor, field) => {
    const t = await fixture.createTenant(`act-${newId()}`);
    const ada = await seedUser(fixture, t.id, 'ada', 'ada@example.com');
    const clientId = await clientWithRedirect(t.name);
    const res = await send(fixture, t.name, ada, bodyFor(clientId));
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain(field);
    expect(await outboxOf(fixture, t.id)).toEqual([]);
  });

  it('refuses a caller below the subject’s capabilities, and 404s an unknown id', async () => {
    const t = await fixture.createTenant(`act-${newId()}`);
    const root = await seedUser(fixture, t.id, 'root', 'root@example.com');
    await withTenant(fixture.app.db, t.id, async (tx) => {
      const admin = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
      const role = await roleRepository(tx).byName(TENANT_ADMIN, admin?.id ?? '');
      await roleRepository(tx).assignToSubject(root, role?.id ?? '');
    });
    const body = { actions: ['configure-totp'] };
    expect((await send(fixture, t.name, root, body)).statusCode).toBe(403);
    expect((await send(fixture, t.name, newId(), body)).statusCode).toBe(404);
    expect((await send(fixture, t.name, root, body, ['view-users'])).statusCode).toBe(403);
    expect(await outboxOf(fixture, t.id)).toEqual([]);
  });

  it('is retired by POST …/password, which sets the password another way', async () => {
    const t = await fixture.createTenant(`act-${newId()}`);
    await allowReset(fixture, t.id);
    const ada = await seedUser(fixture, t.id, 'ada', 'ada@example.com');
    expect((await send(fixture, t.name, ada, { actions: ['update-password'] })).statusCode).toBe(
      202,
    );
    expect((await send(fixture, t.name, ada, { actions: ['configure-totp'] })).statusCode).toBe(
      202,
    );
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const issued = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/subjects/${ada}/password`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(issued.statusCode).toBe(201);
    const rows = await tokensOf(fixture, t.id, ada);
    expect(rows.map((row) => [row.actions, row.consumedAt !== null])).toEqual(
      expect.arrayContaining([
        [['update-password'], true],
        [['configure-totp'], false],
      ]),
    );
  });
});
