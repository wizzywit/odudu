import { withTenant } from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { auditRepository } from '@odudu/domain-audit';
import { users } from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { evaluateClaims, standardClaimMappers } from '@odudu/protocol-oidc';
import { eq } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { createPasswordSubject, createSignInClient, signInForTokens } from '#/testing/sign-in';
import { tenants } from '@odudu/db';

const PASSWORD = 'correct horse battery staple';
// What the signer adds around the mapped claims, which evaluation leaves out.
const ENVELOPE = new Set([
  'iss',
  'aud',
  'iat',
  'exp',
  'jti',
  'sid',
  'grant_id',
  'client_id',
  'scope',
  'auth_time',
  'nonce',
  'acr',
  'amr',
  'at_hash',
  'azp',
]);

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

function payloadOf(jwt: unknown): Record<string, unknown> {
  if (typeof jwt !== 'string') throw new Error('not a JWT');
  const parsed: unknown = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString());
  if (typeof parsed !== 'object' || parsed === null) throw new Error('not a JWT payload');
  return Object.fromEntries(Object.entries(parsed).filter(([name]) => !ENVELOPE.has(name)));
}

function evaluate(
  tenantName: string,
  token: string,
  clientDbId: string,
  query: string,
): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/clients/${clientDbId}/evaluate?${query}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('GET /clients/:id/evaluate', () => {
  it('answers exactly the claims a real sign-in issues, and audits the evaluation', async () => {
    const t = await fixture.createTenant(`eval-${newId()}`);
    const client = await createSignInClient(fixture, t.id);
    const subject = await createPasswordSubject(fixture, t.id, 'ada', PASSWORD);
    await withTenant(fixture.app.db, t.id, (tx) =>
      tx
        .update(users)
        .set({ name: 'Ada Lovelace', email: 'ada@example.com', emailVerified: true })
        .where(eq(users.subjectId, subject)),
    );
    const scope = 'openid profile email';
    const issued = await signInForTokens(fixture, t.name, client, 'ada', PASSWORD, scope);
    const token = await fixture.adminToken(t.name, ['manage-clients', 'view-users']);

    const res = await evaluate(
      t.name,
      token,
      client.id,
      `subject=${subject}&scope=${encodeURIComponent(scope)}`,
    );
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      scope: string;
      id_token: Record<string, unknown>;
      access_token: Record<string, unknown>;
      userinfo: Record<string, unknown>;
    }>();
    expect(body.scope).toBe(scope);
    expect(body.id_token).toEqual(payloadOf(issued.id_token));
    // An access token carries `sub` in its envelope whether or not a mapper maps it.
    expect({ ...body.access_token, sub: subject }).toEqual(payloadOf(issued.access_token));
    expect(body.id_token).toMatchObject({
      sub: subject,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    });

    const userinfo = await fixture.http.inject({
      url: `/tenants/${t.name}/protocol/openid-connect/userinfo`,
      headers: { authorization: `Bearer ${String(issued.access_token)}` },
    });
    expect(body.userinfo).toEqual(userinfo.json());

    const rows = await withTenant(fixture.app.db, t.id, (tx) =>
      auditRepository(tx).list({ action: 'client.evaluate', limit: 5 }),
    );
    expect(rows[0]).toMatchObject({ resourceType: 'client', resourceId: client.id });
    expect(rows[0]?.detail).toEqual({ subject_id: subject, scope });
  });

  it('drops a scope the client is not assigned, and has no ID token without openid', async () => {
    const t = await fixture.createTenant(`eval-${newId()}`);
    const client = await createSignInClient(fixture, t.id);
    const subject = await createPasswordSubject(fixture, t.id, 'ada', PASSWORD);
    const token = await fixture.adminToken(t.name, ['manage-clients', 'view-users']);
    const res = await evaluate(t.name, token, client.id, `subject=${subject}&scope=email+nonsense`);
    expect(res.json<{ scope: string; id_token: unknown }>()).toMatchObject({
      scope: 'email',
      id_token: null,
    });
  });

  it('needs view-users beside manage-clients, and 404s an unknown client or subject', async () => {
    const t = await fixture.createTenant(`eval-${newId()}`);
    const client = await createSignInClient(fixture, t.id);
    const subject = await createPasswordSubject(fixture, t.id, 'ada', PASSWORD);
    const clientsOnly = await fixture.adminToken(t.name, ['manage-clients']);
    expect((await evaluate(t.name, clientsOnly, client.id, `subject=${subject}`)).statusCode).toBe(
      403,
    );

    const both = await fixture.adminToken(t.name, ['manage-clients', 'view-users']);
    expect((await evaluate(t.name, both, newId(), `subject=${subject}`)).statusCode).toBe(404);
    expect((await evaluate(t.name, both, client.id, `subject=${newId()}`)).statusCode).toBe(404);
    expect((await evaluate(t.name, both, client.id, 'scope=openid')).statusCode).toBe(400);
    const tooLong = `subject=${subject}&scope=${'a'.repeat(2049)}`;
    expect((await evaluate(t.name, both, client.id, tooLong)).statusCode).toBe(400);
  });

  it('reads no client or subject across tenants, probed with a foreign tenant_id', async () => {
    const t = await fixture.createTenant(`eval-${newId()}`);
    const client = await createSignInClient(fixture, t.id);
    const subject = await createPasswordSubject(fixture, t.id, 'ada', PASSWORD);
    await expectCrossTenantMethodProbe(fixture.app.db, {
      seed: async (tx, tenantId) => {
        await tx.insert(tenants).values({ id: tenantId, name: `probe-${newId()}` });
        return { client: client.id, subject };
      },
      verifySeeded: async () => {
        const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
          evaluateClaims(
            tx,
            { claimMappers: standardClaimMappers() },
            { tenantId: t.id, clientDbId: client.id, subjectId: subject, scope: 'openid' },
          ),
        );
        expect(outcome.kind).toBe('ok');
      },
      attempt: (tx, seeded) =>
        evaluateClaims(
          tx,
          { claimMappers: standardClaimMappers() },
          {
            tenantId: newId(),
            clientDbId: seeded.client,
            subjectId: seeded.subject,
            scope: 'openid',
          },
        ),
      expectBlocked: (result) => {
        expect(result).toEqual({ kind: 'client_not_found' });
      },
    });
  });
});
