import { withTenant, type TenantScopedDatabase } from '@odudu/db';
import { hashPassword, subjectRepository, userCredentials, users } from '@odudu/domain-identity';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { clientOidcConfigRepository } from '@odudu/protocol-oidc';
import { type LightMyRequestResponse } from 'fastify';
import { type AdminFixture } from '#/testing/admin-fixture';

export const REDIRECT_URI = 'https://app.example/callback';

// RFC 7636 Appendix B's worked example.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

export interface SignInClient {
  readonly id: string;
  readonly clientId: string;
  readonly secret: string;
}

// A confidential client that asks for no consent, so a correct password
// ends in a code, with a back-channel logout URI when one is given.
export async function createSignInClient(
  fixture: AdminFixture,
  tenantId: string,
  backchannelLogoutUri?: string,
): Promise<SignInClient> {
  const secret = 'sign-in-client-secret';
  return withTenant(fixture.app.db, tenantId, async (tx: TenantScopedDatabase) => {
    const id = newId();
    const clientId = `sign-in-${newId()}`;
    await tx.insert(clients).values({
      id,
      tenantId,
      clientId,
      name: 'Sign-in test client',
      type: 'confidential',
      secretHash: await hashPassword(secret),
    });
    await provisionClientDefaults(tx, id);
    await clientOidcConfigRepository(tx).create({
      clientId: id,
      tenantId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      ...(backchannelLogoutUri === undefined ? {} : { backchannelLogoutUri }),
    });
    return { id, clientId, secret };
  });
}

export async function createPasswordSubject(
  fixture: AdminFixture,
  tenantId: string,
  username: string,
  password: string,
): Promise<string> {
  return withTenant(fixture.app.db, tenantId, async (tx: TenantScopedDatabase) => {
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId, username });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(password) },
    });
    return subject.id;
  });
}

function extractAuthSessionId(body: string): string {
  const match = /name="auth_session_id" value="([^"]*)"/.exec(body);
  const value = match?.[1];
  if (value === undefined) throw new Error('auth_session_id not found in the rendered page');
  return value;
}

// A fresh `/authorize` and one password submission, with no cookie carried
// over from any earlier attempt — each call is a new browser.
export async function submitPassword(
  fixture: AdminFixture,
  tenantName: string,
  clientId: string,
  username: string,
  password: string,
  scope = 'openid',
): Promise<LightMyRequestResponse> {
  // A code expires at the fixture's clock plus its lifetime, and is redeemed
  // against the database's own now(). The clock only moves when told to, so in
  // a long run it falls behind and the code is dead on arrival: bring it up to
  // the wall, never back past a time a test advanced it to.
  const wall = new Date();
  if (fixture.clock.now() < wall) fixture.clock.set(wall);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope,
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  const started = await fixture.http.inject({
    url: `/tenants/${tenantName}/protocol/openid-connect/auth?${params.toString()}`,
  });
  if (started.statusCode !== 200) {
    throw new Error(`/authorize answered ${String(started.statusCode)}`);
  }
  return fixture.http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/login-actions/authenticate`,
    payload: new URLSearchParams({
      auth_session_id: extractAuthSessionId(started.body),
      username,
      password,
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

function basic(client: SignInClient): string {
  return `Basic ${Buffer.from(`${client.clientId}:${client.secret}`).toString('base64')}`;
}

// Redeems the code a sign-in's redirect carries.
export async function redeemCode(
  fixture: AdminFixture,
  tenantName: string,
  client: SignInClient,
  login: LightMyRequestResponse,
): Promise<LightMyRequestResponse> {
  const location = login.headers.location;
  if (login.statusCode !== 302 || typeof location !== 'string') {
    throw new Error(`the sign-in answered ${String(login.statusCode)}, not a redirect`);
  }
  const code = new URL(location).searchParams.get('code');
  if (code === null) throw new Error(`no code in ${location}`);
  return fixture.http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/protocol/openid-connect/token`,
    payload: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: VERIFIER,
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic(client) },
  });
}

// Signs in and redeems the code, answering the token response it bought.
export async function signInForTokens(
  fixture: AdminFixture,
  tenantName: string,
  client: SignInClient,
  username: string,
  password: string,
  scope = 'openid',
): Promise<Record<string, unknown>> {
  const login = await submitPassword(
    fixture,
    tenantName,
    client.clientId,
    username,
    password,
    scope,
  );
  const redeemed = await redeemCode(fixture, tenantName, client, login);
  if (redeemed.statusCode !== 200) {
    throw new Error(`the code redemption answered ${String(redeemed.statusCode)}`);
  }
  return redeemed.json<Record<string, unknown>>();
}

// Signs in and redeems the code, answering the refresh token it bought.
export async function signInForRefreshToken(
  fixture: AdminFixture,
  tenantName: string,
  client: SignInClient,
  username: string,
  password: string,
  scope = 'openid',
): Promise<string> {
  const tokens = await signInForTokens(fixture, tenantName, client, username, password, scope);
  const refreshToken = tokens.refresh_token;
  if (typeof refreshToken !== 'string') throw new Error('the code bought no refresh token');
  return refreshToken;
}

export async function refresh(
  fixture: AdminFixture,
  tenantName: string,
  client: SignInClient,
  refreshToken: string,
): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/protocol/openid-connect/token`,
    payload: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic(client) },
  });
}
