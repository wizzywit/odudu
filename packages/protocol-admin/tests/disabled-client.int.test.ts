import { type SessionLifespans } from '@odudu/authn-flows';
import { withTenant } from '@odudu/db';
import { hashPassword, subjectRepository, userCredentials, users } from '@odudu/domain-identity';
import { clientRepository, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import {
  clientOidcConfigRepository,
  resolveExchangeToken,
  type ResolveDeps,
} from '@odudu/protocol-oidc';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

// RFC 7636 Appendix B's worked example — the one PKCE pair every OIDC
// integration test in this repository reuses rather than generating its
// own.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const REDIRECT_URI = 'https://app.example/callback';
const PASSWORD = 'correct horse battery staple';
const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const RESOURCE = 'https://api.example';

interface DisableableClient {
  clientDbId: string;
  clientId: string;
  secret: string;
}

// A confidential client this suite can both log a user into and disable
// through the admin API afterwards — unlike `fixture.createConfidentialClient`,
// this one is registered for `authorization_code` and `refresh_token`, and
// owns a real user, so it can mint every token shape the five endpoints
// below are asked to honour (or refuse).
async function createLoginCapableClient(
  tenantName: string,
  tenantId: string,
  username: string,
): Promise<DisableableClient> {
  const secret = `secret-${newId()}`;
  const clientId = `client-${newId()}`;
  await withTenant(fixture.app.db, tenantId, async (tx) => {
    const client = await clientRepository(tx).create({
      tenantId,
      clientId,
      name: 'Test login-capable client',
      type: 'confidential',
      secretHash: await hashPassword(secret),
    });
    await provisionClientDefaults(tx, client.id);
    await clientOidcConfigRepository(tx).create({
      clientId: client.id,
      tenantId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code', 'refresh_token', TOKEN_EXCHANGE_GRANT],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [RESOURCE],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId, username });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(PASSWORD) },
    });
  });
  const clientRow = await withTenant(fixture.app.db, tenantId, (tx) =>
    clientRepository(tx).byClientId(clientId),
  );
  if (clientRow === null) throw new Error('fixture: client not found after creation');
  return { clientDbId: clientRow.id, clientId, secret };
}

function basicAuth(clientId: string, secret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`;
}

function setCookieValue(res: LightMyRequestResponse): string | undefined {
  const raw = res.headers['set-cookie'];
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return values.find((value) => !value.includes('-persistent='))?.split(';')[0];
}

function locationHeader(res: LightMyRequestResponse): string {
  const location = res.headers.location;
  if (typeof location !== 'string') throw new Error('expected a location header');
  return location;
}

interface LoggedInTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
}

// Signs the client's own user in through a real `/authorize` +
// login-actions round trip, all the way to a redeemed `authorization_code`
// grant carrying `openid offline_access` — the same shape `loginAndGetToken`
// in `packages/protocol-oidc/tests/token-exchange.int.test.ts` produces,
// reused here rather than re-derived, so this suite mints tokens the same
// way a real client would.
async function loginAndGetTokens(
  tenantName: string,
  client: DisableableClient,
  username: string,
  options: { resource?: string } = {},
): Promise<LoggedInTokens> {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: REDIRECT_URI,
    scope: 'openid offline_access',
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...(options.resource !== undefined ? { resource: options.resource } : {}),
  });
  const authorize = await fixture.http.inject({
    url: `/tenants/${tenantName}/protocol/openid-connect/auth?${params.toString()}`,
  });
  if (authorize.statusCode !== 200) {
    throw new Error(
      `expected /authorize to render the login form, got ${String(authorize.statusCode)}`,
    );
  }
  const match = /name="auth_session_id" value="([^"]*)"/.exec(authorize.body);
  const authSessionId = match?.[1];
  if (authSessionId === undefined) throw new Error('auth_session_id not found in the login form');

  const form = new URLSearchParams({
    auth_session_id: authSessionId,
    username,
    password: PASSWORD,
  });
  const submitted = await fixture.http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/login-actions/authenticate`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  if (submitted.statusCode !== 302) {
    throw new Error(`expected a successful login, got ${String(submitted.statusCode)}`);
  }
  const cookie = setCookieValue(submitted);
  if (cookie === undefined) throw new Error('expected a set-cookie header from a successful login');
  const code = new URL(locationHeader(submitted)).searchParams.get('code');
  if (code === null) throw new Error('expected a code on the login redirect');

  const redeemForm = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
  });
  const redeemed = await fixture.http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/protocol/openid-connect/token`,
    payload: redeemForm.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuth(client.clientId, client.secret),
    },
  });
  if (redeemed.statusCode !== 200) {
    throw new Error(`expected /token to redeem the code, got ${String(redeemed.statusCode)}`);
  }
  const body = redeemed.json<{ access_token: string; id_token: string; refresh_token: string }>();
  return {
    accessToken: body.access_token,
    idToken: body.id_token,
    refreshToken: body.refresh_token,
  };
}

async function disable(tenantName: string, clientDbId: string): Promise<void> {
  const res = await fixture.patchClient(tenantName, clientDbId, { enabled: false });
  expect(res.statusCode).toBe(200);
}

// Decodes without verifying: used only to read what a real issuance path
// minted (the `iss` an id_token's own tenant signed), never to make a
// trust decision.
function decodeUnverified(token: string): Record<string, unknown> {
  const segment = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

// Generous enough that no session under test idles out from underneath a
// liveness check — this suite's own client-enabled rule is what each case
// pins, not the idle window.
const GENEROUS_LIFESPANS: SessionLifespans = {
  ssoSessionIdleSeconds: 30 * 24 * 3600,
  ssoSessionMaxSeconds: 30 * 24 * 3600,
  rememberMeIdleSeconds: 30 * 24 * 3600,
  rememberMeMaxSeconds: 30 * 24 * 3600,
};

// A resource server distinct from the client under test, entitled to
// describe a token at /introspect by sharing `RESOURCE` in its own
// registered `audiences` (RFC 7662 §2.2; see introspect.int.test.ts's own
// comment on the same entitlement rule). Kept enabled throughout, so a
// refusal in these tests can only be the subject client's own doing.
async function createIntrospectionCaller(
  tenantId: string,
): Promise<{ clientId: string; secret: string }> {
  const secret = `secret-${newId()}`;
  const clientId = `caller-${newId()}`;
  await withTenant(fixture.app.db, tenantId, async (tx) => {
    const client = await clientRepository(tx).create({
      tenantId,
      clientId,
      name: 'Test introspection caller',
      type: 'confidential',
      secretHash: await hashPassword(secret),
    });
    await provisionClientDefaults(tx, client.id);
    await clientOidcConfigRepository(tx).create({
      clientId: client.id,
      tenantId,
      redirectUris: [],
      // Exempt from the redirect-uri presence constraint
      // (client_oidc_config_redirect_uris_present, migration 0007): this
      // client only ever authenticates at /introspect, never at /token.
      grantTypes: ['client_credentials'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [RESOURCE],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });
  });
  return { clientId, secret };
}

// Impersonation — an exchange with no actor_token — defaults to refused
// (client-oidc-config.ts), so a caller exchanging someone else's token
// must opt in first.
async function allowImpersonation(tenantId: string, oauthClientId: string): Promise<void> {
  await withTenant(fixture.app.db, tenantId, async (tx) => {
    const client = await clientRepository(tx).byClientId(oauthClientId);
    if (client === null) throw new Error(`fixture: unknown client ${oauthClientId}`);
    await clientOidcConfigRepository(tx).update(client.id, {
      tokenExchangeImpersonationAllowed: true,
    });
  });
}

describe('a client disabled after a token was issued to it', () => {
  it('is refused at /userinfo', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const client = await createLoginCapableClient(t.name, t.id, 'ada');
    const { accessToken } = await loginAndGetTokens(t.name, client, 'ada');

    const before = await fixture.http.inject({
      method: 'GET',
      url: `/tenants/${t.name}/protocol/openid-connect/userinfo`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(before.statusCode).toBe(200);

    await disable(t.name, client.clientDbId);

    const after = await fixture.http.inject({
      method: 'GET',
      url: `/tenants/${t.name}/protocol/openid-connect/userinfo`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(after.statusCode).toBe(401);
  });

  it('is refused at /introspect', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const client = await createLoginCapableClient(t.name, t.id, 'ada');
    const caller = await createIntrospectionCaller(t.id);
    const { accessToken } = await loginAndGetTokens(t.name, client, 'ada', { resource: RESOURCE });

    const introspect = () =>
      fixture.http.inject({
        method: 'POST',
        url: `/tenants/${t.name}/protocol/openid-connect/token/introspect`,
        payload: new URLSearchParams({ token: accessToken }).toString(),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: basicAuth(caller.clientId, caller.secret),
        },
      });

    const before = await introspect();
    expect(before.statusCode).toBe(200);
    expect(before.json<{ active: boolean }>().active).toBe(true);

    await disable(t.name, client.clientDbId);

    const after = await introspect();
    expect(after.statusCode).toBe(200);
    expect(after.json<{ active: boolean }>().active).toBe(false);
  });

  it('cannot exchange its access token', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const exchanger = await fixture.createServiceAccountClient(t.name, []);
    await withTenant(fixture.app.db, t.id, async (tx) => {
      const row = await clientRepository(tx).byClientId(exchanger.clientId);
      if (row === null) throw new Error('fixture: exchanger client not found');
      await clientOidcConfigRepository(tx).update(row.id, {
        grantTypes: [TOKEN_EXCHANGE_GRANT],
        redirectUris: [REDIRECT_URI],
      });
    });
    await allowImpersonation(t.id, exchanger.clientId);
    const subjectClient = await createLoginCapableClient(t.name, t.id, 'ada');
    const { accessToken } = await loginAndGetTokens(t.name, subjectClient, 'ada');

    const exchange = () =>
      fixture.http.inject({
        method: 'POST',
        url: `/tenants/${t.name}/protocol/openid-connect/token`,
        payload: new URLSearchParams({
          grant_type: TOKEN_EXCHANGE_GRANT,
          subject_token: accessToken,
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        }).toString(),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: basicAuth(exchanger.clientId, exchanger.secret),
        },
      });

    const before = await exchange();
    expect(before.statusCode).toBe(200);

    await disable(t.name, subjectClient.clientDbId);

    const after = await exchange();
    expect(after.statusCode).toBe(400);
    expect(after.json<{ error: string }>().error).toBe('invalid_request');
  });

  it('cannot exchange its refresh token', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const exchanger = await fixture.createServiceAccountClient(t.name, []);
    await withTenant(fixture.app.db, t.id, async (tx) => {
      const row = await clientRepository(tx).byClientId(exchanger.clientId);
      if (row === null) throw new Error('fixture: exchanger client not found');
      await clientOidcConfigRepository(tx).update(row.id, {
        grantTypes: [TOKEN_EXCHANGE_GRANT],
        redirectUris: [REDIRECT_URI],
      });
    });
    await allowImpersonation(t.id, exchanger.clientId);
    const subjectClient = await createLoginCapableClient(t.name, t.id, 'ada');
    const { refreshToken } = await loginAndGetTokens(t.name, subjectClient, 'ada');

    const exchange = () =>
      fixture.http.inject({
        method: 'POST',
        url: `/tenants/${t.name}/protocol/openid-connect/token`,
        payload: new URLSearchParams({
          grant_type: TOKEN_EXCHANGE_GRANT,
          subject_token: refreshToken,
          subject_token_type: 'urn:ietf:params:oauth:token-type:refresh_token',
        }).toString(),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: basicAuth(exchanger.clientId, exchanger.secret),
        },
      });

    const before = await exchange();
    expect(before.statusCode).toBe(200);

    await disable(t.name, subjectClient.clientDbId);

    const after = await exchange();
    expect(after.statusCode).toBe(400);
    expect(after.json<{ error: string }>().error).toBe('invalid_request');
  });

  // An id_token names no grant, so only a direct `client.enabled` read
  // (resolveIdToken, token-exchange-subject.ts) can refuse it. Its audience
  // must name the requesting client, making this a self-exchange — and a
  // disabled client can no longer authenticate at /token at all, so an HTTP
  // exchange attempt can't tell that gate's refusal apart from this one.
  // Calling `resolveExchangeToken` directly, as SUBJECT-03 in
  // token-exchange.int.test.ts does for the audience rule, proves this
  // branch's own read instead.
  it('cannot exchange its id_token, which names no grant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const client = await createLoginCapableClient(t.name, t.id, 'ada');
    const { idToken } = await loginAndGetTokens(t.name, client, 'ada');
    const issuer = decodeUnverified(idToken).iss;
    if (typeof issuer !== 'string') throw new Error('expected a string iss claim on the id_token');

    const resolveDeps: ResolveDeps = {
      issuer,
      requestingClientId: client.clientId,
      lifespans: GENEROUS_LIFESPANS,
      now: fixture.clock.now(),
    };
    const resolve = () =>
      withTenant(fixture.app.db, t.id, (tx) =>
        resolveExchangeToken(tx, resolveDeps, 'id_token', idToken),
      );

    const before = await resolve();
    expect(before.kind).toBe('ok');

    await disable(t.name, client.clientDbId);

    const after = await resolve();
    expect(after).toEqual({ kind: 'refused' });
  });
});
