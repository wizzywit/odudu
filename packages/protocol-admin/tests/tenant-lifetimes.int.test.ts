import { actionTokens } from '@odudu/account';
import { authenticationSessions } from '@odudu/authn-flows';
import { tenants, withTenant } from '@odudu/db';
import { userRepository, subjectRepository } from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { refreshTokens } from '@odudu/protocol-oidc';
import { eq } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import {
  createPasswordSubject,
  createSignInClient,
  redeemCode,
  signInForTokens,
  submitPassword,
  type SignInClient,
} from '#/testing/sign-in';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture({ deploymentSmtp: true });
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const PASSWORD = 'correct horse battery staple';

const DEFAULTS = {
  access_token_ttl_seconds: 300,
  id_token_ttl_seconds: 300,
  refresh_token_ttl_seconds: 1_209_600,
  authorization_code_ttl_seconds: 60,
  login_ttl_seconds: 1800,
  verify_email_ttl_seconds: 43_200,
  reset_password_ttl_seconds: 300,
};

async function patchSettings(
  tenantName: string,
  payload: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  const token = await fixture.adminToken(tenantName, ['manage-tenant']);
  return fixture.http.inject({
    method: 'PATCH',
    url: `/admin/tenants/${tenantName}/settings`,
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
}

async function patchClient(
  tenantName: string,
  client: SignInClient,
  payload: Record<string, unknown>,
): Promise<void> {
  const res = await fixture.patchClient(tenantName, client.id, payload);
  expect(res.statusCode, res.body).toBe(200);
}

function payloadOf(jwt: unknown): Record<string, unknown> {
  if (typeof jwt !== 'string') throw new Error('expected a JWT');
  const segment = jwt.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

async function signedInTenant(): Promise<{
  tenant: { id: string; name: string };
  client: SignInClient;
  username: string;
}> {
  const tenant = await fixture.createTenant(`ttl-${newId()}`);
  const client = await createSignInClient(fixture, tenant.id);
  const username = `ada-${newId()}`;
  await createPasswordSubject(fixture, tenant.id, username, PASSWORD);
  return { tenant, client, username };
}

describe('tenant-wide lifetimes', () => {
  it('reads today’s values back as every tenant’s defaults', async () => {
    const t = await fixture.createTenant(`ttl-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject(DEFAULTS);
  });

  it('refuses a lifetime past the caps the client columns already hold', async () => {
    const t = await fixture.createTenant(`ttl-${newId()}`);
    const res = await patchSettings(t.name, {
      access_token_ttl_seconds: 3601,
      id_token_ttl_seconds: 0,
      authorization_code_ttl_seconds: 601,
    });
    expect(res.statusCode).toBe(400);
    const paths = res.json<{ errors: { path: string }[] }>().errors.map((error) => error.path);
    expect(paths.sort()).toEqual([
      'access_token_ttl_seconds',
      'authorization_code_ttl_seconds',
      'id_token_ttl_seconds',
    ]);
  });

  it('issues a client with no lifetime of its own the tenant’s three token lifetimes', async () => {
    const { tenant, client, username } = await signedInTenant();
    await patchClient(tenant.name, client, {
      access_token_ttl_seconds: null,
      refresh_token_ttl_seconds: null,
    });
    expect(
      (
        await patchSettings(tenant.name, {
          access_token_ttl_seconds: 120,
          id_token_ttl_seconds: 90,
          refresh_token_ttl_seconds: 7200,
        })
      ).statusCode,
    ).toBe(200);

    const tokens = await signInForTokens(fixture, tenant.name, client, username, PASSWORD);
    expect(tokens.expires_in).toBe(120);
    const idToken = payloadOf(tokens.id_token);
    expect(Number(idToken.exp) - Number(idToken.iat)).toBe(90);

    const stored = await withTenant(fixture.app.db, tenant.id, (tx) =>
      tx.select().from(refreshTokens),
    );
    expect(stored).toHaveLength(1);
    const lifetime = (stored[0]?.expiresAt.getTime() ?? 0) - fixture.clock.now().getTime();
    expect(lifetime).toBe(7200 * 1000);
  });

  it('lets a client’s own lifetime override the tenant’s', async () => {
    const { tenant, client, username } = await signedInTenant();
    await patchSettings(tenant.name, { access_token_ttl_seconds: 120, id_token_ttl_seconds: 90 });
    await patchClient(tenant.name, client, {
      access_token_ttl_seconds: 600,
      id_token_ttl_seconds: 450,
    });

    const tokens = await signInForTokens(fixture, tenant.name, client, username, PASSWORD);
    expect(tokens.expires_in).toBe(600);
    const idToken = payloadOf(tokens.id_token);
    expect(Number(idToken.exp) - Number(idToken.iat)).toBe(450);
  });

  it('[OIDC-CORE-16.9-01] expires an authorization code at the tenant’s code lifetime', async () => {
    const { tenant, client, username } = await signedInTenant();
    await patchSettings(tenant.name, { authorization_code_ttl_seconds: 5 });

    // Redemption measures a code against the database's own clock, so the
    // code is issued six seconds in that clock's past instead.
    fixture.clock.advance(-6_000);
    const login = await submitPassword(fixture, tenant.name, client.clientId, username, PASSWORD);
    fixture.clock.advance(6_000);
    expect(login.statusCode).toBe(302);
    const redeemed = await redeemCode(fixture, tenant.name, client, login);
    expect(redeemed.statusCode).toBe(400);
    expect(redeemed.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('keeps an authorization code redeemable inside the tenant’s code lifetime', async () => {
    const { tenant, client, username } = await signedInTenant();
    await patchSettings(tenant.name, { authorization_code_ttl_seconds: 600 });

    fixture.clock.advance(-300_000);
    const login = await submitPassword(fixture, tenant.name, client.clientId, username, PASSWORD);
    fixture.clock.advance(300_000);
    const redeemed = await redeemCode(fixture, tenant.name, client, login);
    expect(redeemed.statusCode).toBe(200);
  });

  it('ends a login left open past the tenant’s login lifetime', async () => {
    const { tenant, client, username } = await signedInTenant();
    await patchSettings(tenant.name, { login_ttl_seconds: 120 });

    const started = await fixture.http.inject({
      url: `/tenants/${tenant.name}/protocol/openid-connect/auth?${new URLSearchParams({
        response_type: 'code',
        client_id: client.clientId,
        redirect_uri: 'https://app.example/callback',
        scope: 'openid',
        code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        code_challenge_method: 'S256',
      }).toString()}`,
    });
    expect(started.statusCode).toBe(200);
    const sessions = await withTenant(fixture.app.db, tenant.id, (tx) =>
      tx.select().from(authenticationSessions),
    );
    expect(sessions).toHaveLength(1);
    expect((sessions[0]?.expiresAt.getTime() ?? 0) - fixture.clock.now().getTime()).toBe(120_000);

    const authSessionId = /name="auth_session_id" value="([^"]*)"/u.exec(started.body)?.[1] ?? '';
    fixture.clock.advance(121_000);
    const late = await fixture.http.inject({
      method: 'POST',
      url: `/tenants/${tenant.name}/login-actions/authenticate`,
      payload: new URLSearchParams({
        auth_session_id: authSessionId,
        username,
        password: PASSWORD,
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(late.statusCode).not.toBe(302);
  });

  it('mints reset and verification links with the tenant’s action-token lifetimes', async () => {
    const t = await fixture.createTenant(`ttl-${newId()}`);
    await fixture.owner.db
      .update(tenants)
      .set({ resetPasswordAllowed: true })
      .where(eq(tenants.id, t.id));
    await patchSettings(t.name, { reset_password_ttl_seconds: 900, verify_email_ttl_seconds: 600 });
    const ada = await withTenant(fixture.app.db, t.id, async (tx) => {
      const subject = await subjectRepository(tx).create({ tenantId: t.id, type: 'user' });
      await userRepository(tx).create({
        subjectId: subject.id,
        tenantId: t.id,
        username: 'ada',
        email: 'ada@example.com',
      });
      return subject.id;
    });
    const token = await fixture.adminToken(t.name, ['manage-users']);
    for (const tail of ['password-reset', 'verification']) {
      const res = await fixture.http.inject({
        method: 'POST',
        url: `/admin/tenants/${t.name}/subjects/${ada}/${tail}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(202);
    }

    const issued = await withTenant(fixture.app.db, t.id, (tx) =>
      tx.select().from(actionTokens).where(eq(actionTokens.subjectId, ada)),
    );
    const lifetimes = Object.fromEntries(
      issued.map((row) => [
        row.type,
        Math.round((row.expiresAt.getTime() - row.createdAt.getTime()) / 1000),
      ]),
    );
    expect(lifetimes.reset_password).toBeGreaterThanOrEqual(898);
    expect(lifetimes.reset_password).toBeLessThanOrEqual(902);
    expect(lifetimes.verify_email).toBeGreaterThanOrEqual(598);
    expect(lifetimes.verify_email).toBeLessThanOrEqual(602);
  });
});
