import { withTenant } from '@odudu/db';
import { loginFailures, users } from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { eq } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import {
  createPasswordSubject,
  createSignInClient,
  redeemCode,
  submitPassword,
  type SignInClient,
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

interface Setup {
  readonly tenant: { readonly id: string; readonly name: string };
  readonly client: SignInClient;
}

async function tenantWithEmailLogin(on: boolean): Promise<Setup> {
  const tenant = await fixture.createTenant(`email-${newId()}`);
  const client = await createSignInClient(fixture, tenant.id);
  const token = await fixture.adminToken(tenant.name, ['manage-tenant']);
  const res = await fixture.http.inject({
    method: 'PATCH',
    url: `/admin/tenants/${tenant.name}/settings`,
    headers: { authorization: `Bearer ${token}` },
    payload: { login_with_email: on, brute_force_max_failures: 2 },
  });
  expect(res.statusCode, res.body).toBe(200);
  return { tenant, client };
}

async function userWithEmail(
  tenantId: string,
  username: string,
  email: string,
  verified: boolean,
): Promise<string> {
  const subjectId = await createPasswordSubject(fixture, tenantId, username, PASSWORD);
  await withTenant(fixture.app.db, tenantId, (tx) =>
    tx.update(users).set({ email, emailVerified: verified }).where(eq(users.subjectId, subjectId)),
  );
  return subjectId;
}

async function attempt(
  setup: Setup,
  login: string,
  password = PASSWORD,
): Promise<LightMyRequestResponse> {
  return submitPassword(fixture, setup.tenant.name, setup.client.clientId, login, password);
}

// The refusal page carries the form's own auth_session_id, which differs per
// attempt and is the only thing that may.
function refusalOf(res: LightMyRequestResponse): string {
  return res.body.replace(/name="auth_session_id" value="[^"]*"/u, '');
}

function subOf(tokens: Record<string, unknown>): unknown {
  const idToken = tokens.id_token;
  if (typeof idToken !== 'string') throw new Error('expected an id_token');
  const payload: unknown = JSON.parse(
    Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
  );
  return (payload as Record<string, unknown>).sub;
}

describe('signing in with an email address', () => {
  it('reads login_with_email back as off for every tenant', async () => {
    const t = await fixture.createTenant(`email-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json()).toMatchObject({ login_with_email: false });
  });

  it('names the field for an address only while the setting is on', async () => {
    for (const on of [false, true]) {
      const setup = await tenantWithEmailLogin(on);
      await userWithEmail(setup.tenant.id, 'ada', 'ada@example.com', true);
      const refused = await attempt(setup, 'ada', 'wrong');
      expect(refused.body).toContain(on ? '<label>Username or email ' : '<label>Username <');
    }
  });

  it('refuses a verified address while the setting is off, exactly as an unknown username', async () => {
    const setup = await tenantWithEmailLogin(false);
    await userWithEmail(setup.tenant.id, 'ada', 'ada@example.com', true);

    const byEmail = await attempt(setup, 'ada@example.com');
    const unknown = await attempt(setup, 'nobody');
    expect(byEmail.statusCode).toBe(unknown.statusCode);
    expect(refusalOf(byEmail)).toBe(refusalOf(unknown));
  });

  it('signs in with a verified address, whatever its case, as the subject holding it', async () => {
    const setup = await tenantWithEmailLogin(true);
    const ada = await userWithEmail(setup.tenant.id, 'ada', 'Ada@Example.com', true);

    const login = await attempt(setup, 'ADA@example.COM');
    expect(login.statusCode).toBe(302);
    const redeemed = await redeemCode(fixture, setup.tenant.name, setup.client, login);
    expect(redeemed.statusCode).toBe(200);
    expect(subOf(redeemed.json())).toBe(ada);
  });

  it('still signs in by username while the setting is on', async () => {
    const setup = await tenantWithEmailLogin(true);
    await userWithEmail(setup.tenant.id, 'ada', 'ada@example.com', true);
    expect((await attempt(setup, 'ada')).statusCode).toBe(302);
  });

  it('answers an unverified address exactly as an unknown username', async () => {
    const setup = await tenantWithEmailLogin(true);
    await userWithEmail(setup.tenant.id, 'ada', 'ada@example.com', false);

    const byEmail = await attempt(setup, 'ada@example.com');
    const unknown = await attempt(setup, 'nobody@example.com');
    expect(byEmail.statusCode).toBe(unknown.statusCode);
    expect(refusalOf(byEmail)).toBe(refusalOf(unknown));
  });

  it('answers an address two subjects hold in different cases as a miss', async () => {
    const setup = await tenantWithEmailLogin(true);
    await userWithEmail(setup.tenant.id, 'ada', 'ada@example.com', true);
    await userWithEmail(setup.tenant.id, 'ada2', 'ADA@example.com', true);

    const byEmail = await attempt(setup, 'Ada@Example.com');
    const unknown = await attempt(setup, 'nobody@example.com');
    expect(refusalOf(byEmail)).toBe(refusalOf(unknown));
  });

  it('lets a verified address win over a username another subject chose to match it', async () => {
    const setup = await tenantWithEmailLogin(true);
    const holder = await userWithEmail(setup.tenant.id, 'bob', 'bob@example.com', true);
    await userWithEmail(setup.tenant.id, 'bob@example.com', 'x@example.com', true);

    const login = await attempt(setup, 'bob@example.com');
    const redeemed = await redeemCode(fixture, setup.tenant.name, setup.client, login);
    expect(subOf(redeemed.json())).toBe(holder);
  });

  it('still signs in by an @-bearing username that no verified address matches', async () => {
    const setup = await tenantWithEmailLogin(true);
    const named = await userWithEmail(setup.tenant.id, 'carol@team', 'carol@example.com', true);

    const login = await attempt(setup, 'carol@team');
    const redeemed = await redeemCode(fixture, setup.tenant.name, setup.client, login);
    expect(subOf(redeemed.json())).toBe(named);
  });

  it('counts a wrong password by address against the subject it resolves to', async () => {
    const setup = await tenantWithEmailLogin(true);
    const ada = await userWithEmail(setup.tenant.id, 'ada', 'ada@example.com', true);

    expect((await attempt(setup, 'ada@example.com', 'wrong')).statusCode).toBe(200);
    expect((await attempt(setup, 'ADA@example.com', 'wrong')).statusCode).toBe(200);

    const recorded = await withTenant(fixture.app.db, setup.tenant.id, (tx) =>
      tx.select().from(loginFailures).where(eq(loginFailures.subjectId, ada)),
    );
    expect(recorded[0]?.lockedUntil).not.toBeNull();
    expect((await attempt(setup, 'ada')).statusCode).not.toBe(302);
  });
});
