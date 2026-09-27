import { withTenant, type TenantScopedDatabase } from '@odudu/db';
import { hashPassword, subjectRepository, userCredentials, users } from '@odudu/domain-identity';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { clientOidcConfigRepository } from '@odudu/protocol-oidc';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { revokeConsent, type ConsentAuditEvent } from '#/usecase/consents';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';

// RFC 7636 Appendix B's worked example — the same pair
// protocol-oidc/tests/consent.int.test.ts drives /authorize with.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

interface ConsentRequiredClient {
  readonly id: string;
  readonly clientId: string;
  readonly secret: string;
}

// The admin fixture's own `createConfidentialClient` never sets
// `consentRequired` — it exists to exercise `/token`, not `/authorize` —
// so a client that actually asks for consent is built by hand here, the
// same fields protocol-oidc's own consent.int.test.ts sets on its own
// `setupTenant`. The fixture's `createTenant` already provisions the
// tenant's flow and an active signing key, so neither is repeated here.
async function createConsentRequiredClient(tenantId: string): Promise<ConsentRequiredClient> {
  const secret = 'consent-required-client-secret';
  return withTenant(fixture.app.db, tenantId, async (tx: TenantScopedDatabase) => {
    const clientDbId = newId();
    const clientKey = `consent-client-${newId()}`;
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: clientKey,
      name: 'Consent test client',
      type: 'confidential',
      secretHash: await hashPassword(secret),
    });
    await provisionClientDefaults(tx, clientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      tenantId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      consentRequired: true,
    });
    return { id: clientDbId, clientId: clientKey, secret };
  });
}

async function createPasswordSubject(tenantId: string): Promise<string> {
  return withTenant(fixture.app.db, tenantId, async (tx: TenantScopedDatabase) => {
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId, username: USERNAME });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(PASSWORD) },
    });
    return subject.id;
  });
}

function authorizeUrl(tenantName: string, clientId: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: 'openid offline_access',
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  return `/tenants/${tenantName}/protocol/openid-connect/auth?${params.toString()}`;
}

function extractAuthSessionId(body: string): string {
  const match = /name="auth_session_id" value="([^"]*)"/.exec(body);
  const value = match?.[1];
  if (value === undefined) throw new Error('auth_session_id not found in the rendered page');
  return value;
}

function locationHeader(res: LightMyRequestResponse): string {
  const location = res.headers.location;
  if (typeof location !== 'string') throw new Error('expected a location header');
  return location;
}

// Logs a fresh subject in against a client requiring consent, and returns
// the consent screen's own `auth_session_id` — the shared starting point
// every case below builds on.
async function loginExpectingConsent(
  tenantName: string,
  clientId: string,
  username: string,
): Promise<string> {
  const started = await fixture.http.inject({ url: authorizeUrl(tenantName, clientId) });
  expect(started.statusCode).toBe(200);
  const startAuthSessionId = extractAuthSessionId(started.body);

  const login = await fixture.http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/login-actions/authenticate`,
    payload: new URLSearchParams({
      auth_session_id: startAuthSessionId,
      username,
      password: PASSWORD,
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(login.statusCode).toBe(200);
  expect(login.body).toContain('login-actions/consent');
  return extractAuthSessionId(login.body);
}

async function submitConsent(
  tenantName: string,
  authSessionId: string,
  scopes: string[],
): Promise<LightMyRequestResponse> {
  const params = new URLSearchParams({ auth_session_id: authSessionId, decision: 'allow' });
  for (const scope of scopes) params.append('scope', scope);
  return fixture.http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/login-actions/consent`,
    payload: params.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

async function redeemCode(
  tenantName: string,
  client: ConsentRequiredClient,
  code: string,
): Promise<LightMyRequestResponse> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
  });
  return fixture.http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${client.clientId}:${client.secret}`).toString('base64')}`,
    },
  });
}

describe('GET /admin/tenants/{t}/subjects/{id}/consents', () => {
  it('lists a consent recorded through the real consent screen', async () => {
    const t = await fixture.createTenant(`consents-${newId()}`);
    const client = await createConsentRequiredClient(t.id);
    const subjectId = await createPasswordSubject(t.id);

    const authSessionId = await loginExpectingConsent(t.name, client.clientId, USERNAME);
    const allowed = await submitConsent(t.name, authSessionId, ['offline_access']);
    expect(allowed.statusCode).toBe(302);

    const token = await fixture.adminToken(t.name, ['view-users']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${subjectId}/consents`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json<{
      items: { client_id: string; client_key: string; scope_names: string[] }[];
    }>().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.client_id).toBe(client.id);
    expect(items[0]?.client_key).toBe(client.clientId);
    expect(items[0]?.scope_names).toContain('offline_access');
  });

  it('answers an empty list for a subject with no consents', async () => {
    const t = await fixture.createTenant(`consents-empty-${newId()}`);
    const { id: subjectId } = await fixture.createSubject(t.name, `bare-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${subjectId}/consents`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ items: unknown[] }>().items).toEqual([]);
  });

  it('answers 404 for an unknown subject', async () => {
    const t = await fixture.createTenant(`consents-404-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${newId()}/consents`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses a caller holding neither view-users nor manage-users', async () => {
    const t = await fixture.createTenant(`consents-forbidden-${newId()}`);
    const { id: subjectId } = await fixture.createSubject(t.name, `x-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);

    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${subjectId}/consents`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /admin/tenants/{t}/subjects/{id}/consents/{clientId}', () => {
  it('revokes a consent recorded through the real consent screen, so the next /authorize asks again', async () => {
    const t = await fixture.createTenant(`consents-revoke-${newId()}`);
    const client = await createConsentRequiredClient(t.id);
    const subjectId = await createPasswordSubject(t.id);

    const authSessionId = await loginExpectingConsent(t.name, client.clientId, USERNAME);
    const allowed = await submitConsent(t.name, authSessionId, ['offline_access']);
    expect(allowed.statusCode).toBe(302);

    // Confirmed recorded: a fresh login (no SSO session, no consent
    // screen's own cookie) redirects straight to a code rather than
    // stopping at the consent screen again.
    const beforeStart = await fixture.http.inject({ url: authorizeUrl(t.name, client.clientId) });
    const beforeLogin = await fixture.http.inject({
      method: 'POST',
      url: `/tenants/${t.name}/login-actions/authenticate`,
      payload: new URLSearchParams({
        auth_session_id: extractAuthSessionId(beforeStart.body),
        username: USERNAME,
        password: PASSWORD,
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(beforeLogin.statusCode).toBe(302);

    const token = await fixture.adminToken(t.name, ['manage-users']);
    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/subjects/${subjectId}/consents/${client.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);

    const afterStart = await fixture.http.inject({ url: authorizeUrl(t.name, client.clientId) });
    const afterLogin = await fixture.http.inject({
      method: 'POST',
      url: `/tenants/${t.name}/login-actions/authenticate`,
      payload: new URLSearchParams({
        auth_session_id: extractAuthSessionId(afterStart.body),
        username: USERNAME,
        password: PASSWORD,
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(afterLogin.statusCode).toBe(200);
    expect(afterLogin.body).toContain('login-actions/consent');
  });

  it('does not revoke an already-issued refresh token', async () => {
    const t = await fixture.createTenant(`consents-revoke-tokens-${newId()}`);
    const client = await createConsentRequiredClient(t.id);
    const subjectId = await createPasswordSubject(t.id);

    const authSessionId = await loginExpectingConsent(t.name, client.clientId, USERNAME);
    const allowed = await submitConsent(t.name, authSessionId, ['offline_access']);
    expect(allowed.statusCode).toBe(302);
    const code = new URL(locationHeader(allowed)).searchParams.get('code');
    if (code === null) throw new Error('expected a code from consent');
    const redeemed = await redeemCode(t.name, client, code);
    expect(redeemed.statusCode).toBe(200);
    const refreshToken = redeemed.json<{ refresh_token: string }>().refresh_token;

    const token = await fixture.adminToken(t.name, ['manage-users']);
    const revokeRes = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/subjects/${subjectId}/consents/${client.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(revokeRes.statusCode).toBe(204);

    const refreshed = await fixture.http.inject({
      method: 'POST',
      url: `/tenants/${t.name}/protocol/openid-connect/token`,
      payload: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${client.clientId}:${client.secret}`).toString('base64')}`,
      },
    });
    expect(refreshed.statusCode).toBe(200);
  });

  it('answers 404 for a subject with no consent to that client', async () => {
    const t = await fixture.createTenant(`consents-404-delete-${newId()}`);
    const client = await createConsentRequiredClient(t.id);
    const { id: subjectId } = await fixture.createSubject(t.name, `no-consent-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/subjects/${subjectId}/consents/${client.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses a caller holding only view-users', async () => {
    const t = await fixture.createTenant(`consents-view-only-${newId()}`);
    const client = await createConsentRequiredClient(t.id);
    const { id: subjectId } = await fixture.createSubject(t.name, `x-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/subjects/${subjectId}/consents/${client.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('audits consent.revoke exactly once on a successful revoke, and not on not_found', async () => {
    const t = await fixture.createTenant(`consents-audit-${newId()}`);
    const client = await createConsentRequiredClient(t.id);
    const subjectId = await createPasswordSubject(t.id);
    const authSessionId = await loginExpectingConsent(t.name, client.clientId, USERNAME);
    const allowed = await submitConsent(t.name, authSessionId, ['offline_access']);
    expect(allowed.statusCode).toBe(302);

    const events: ConsentAuditEvent[] = [];
    const revoked = await withTenant(fixture.app.db, t.id, (tx) =>
      revokeConsent(
        tx,
        {
          audit: (_tx, event) => {
            events.push(event);
            return Promise.resolve();
          },
        },
        {
          subjectId,
          clientId: client.id,
          actorSubjectId: 'test-subject',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(revoked.kind).toBe('revoked');
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('consent.revoke');

    const secondEvents: ConsentAuditEvent[] = [];
    const notFound = await withTenant(fixture.app.db, t.id, (tx) =>
      revokeConsent(
        tx,
        {
          audit: (_tx, event) => {
            secondEvents.push(event);
            return Promise.resolve();
          },
        },
        {
          subjectId,
          clientId: client.id,
          actorSubjectId: 'test-subject',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(notFound.kind).toBe('not_found');
    expect(secondEvents).toHaveLength(0);
  });
});
