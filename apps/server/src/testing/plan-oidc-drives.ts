import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import {
  type PlanWorld,
  REDIRECT_URI,
  TARGET_CLIENT,
  TARGET_PASSWORD,
  TARGET_SECRET,
  TARGET_TENANT,
  TARGET_USER,
} from '#/testing/plan-world';
import { type Capture } from '#/testing/plan-paths';

// RFC 7636 Appendix B's pair.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const BASE = `/tenants/${TARGET_TENANT}`;
const OIDC = `${BASE}/protocol/openid-connect`;
const ACTIONS = `${BASE}/login-actions`;

function basic(): Record<string, string> {
  const credentials = Buffer.from(`${TARGET_CLIENT}:${TARGET_SECRET}`).toString('base64');
  return { authorization: `Basic ${credentials}` };
}

function authorizeUrl(extra: Record<string, string> = {}): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: TARGET_CLIENT,
    redirect_uri: REDIRECT_URI,
    scope: 'openid email offline_access',
    state: 'plan-state',
    nonce: 'plan-nonce',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...extra,
  });
  return `${OIDC}/auth?${query.toString()}`;
}

function formOf(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

function sessionCookie(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie'];
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const cookie = values.find((value) => !value.includes('-persistent='))?.split(';')[0];
  if (cookie === undefined) throw new Error('no session cookie was set');
  return cookie;
}

function authSessionId(page: LightMyRequestResponse): string {
  const id = /name="auth_session_id" value="([^"]*)"/u.exec(page.body)?.[1];
  if (id === undefined) throw new Error('the login page carries no auth_session_id');
  return id;
}

function codeOf(res: LightMyRequestResponse): string {
  const location = res.headers.location;
  const code = typeof location === 'string' ? new URL(location).searchParams.get('code') : null;
  if (code === null) throw new Error(`no code in the redirect: ${String(res.statusCode)}`);
  return code;
}

interface Tokens {
  readonly access_token: string;
  readonly id_token: string;
  readonly refresh_token: string;
}

function expectStatus(res: LightMyRequestResponse, status: number, what: string): void {
  if (res.statusCode !== status) {
    throw new Error(
      `${what}: expected ${String(status)}, got ${String(res.statusCode)} ${res.headers.location ?? ''} ${res.body.slice(0, 300)}`,
    );
  }
}

async function login(http: FastifyInstance, capture: Capture): Promise<string> {
  const page = await capture('authorize: no session, renders the login form', 'oidc', () =>
    http.inject({ url: authorizeUrl() }),
  );
  expectStatus(page, 200, 'authorize');
  const submitted = await capture('login: password', 'oidc', () =>
    http.inject({
      method: 'POST',
      url: `${ACTIONS}/authenticate`,
      payload: formOf({
        auth_session_id: authSessionId(page),
        username: TARGET_USER,
        password: TARGET_PASSWORD,
      }),
      headers: FORM,
    }),
  );
  expectStatus(submitted, 302, 'login');
  return sessionCookie(submitted);
}

// Every step of the OpenID Connect flow, each recorded under its own name:
// the statements a step issues are what the plan check explains.
export async function driveOidc(world: PlanWorld, capture: Capture): Promise<void> {
  const http = world.http;
  await world.owner.sql`update tenants set verify_email = false where id = ${world.tenantId}`;

  expectStatus(
    await capture('discovery', 'oidc', () =>
      http.inject({ url: `${BASE}/.well-known/openid-configuration` }),
    ),
    200,
    'discovery',
  );
  expectStatus(
    await capture('jwks', 'oidc', () => http.inject({ url: `${OIDC}/certs` })),
    200,
    'certs',
  );

  const cookie = await login(http, capture);

  const sso = await capture('authorize: live session issues a code', 'oidc', () =>
    http.inject({ url: authorizeUrl(), headers: { cookie } }),
  );
  expectStatus(sso, 302, 'authorize with a session');

  await world.owner.sql`
    delete from consents
     where tenant_id = ${world.tenantId} and subject_id = (select subject_id from users where username = ${TARGET_USER})
       and client_id = (select id from clients where tenant_id = ${world.tenantId} and client_id = 'app-1')`;
  await world.owner.sql`
    update client_oidc_config set consent_required = true
     where client_id = (select id from clients where tenant_id = ${world.tenantId} and client_id = 'app-1')`;
  const [consenting] = await world.owner.sql<{ uri: string }[]>`
    select c.redirect_uris[1] as uri
      from client_oidc_config c join clients k on k.id = c.client_id
     where k.tenant_id = ${world.tenantId} and k.client_id = 'app-1'`;
  if (consenting === undefined) throw new Error('no client app-1');
  const consentPage = await capture('authorize: a client that asks for consent', 'oidc', () =>
    http.inject({
      url: authorizeUrl({
        client_id: 'app-1',
        redirect_uri: consenting.uri,
        scope: 'openid email',
      }),
      headers: { cookie },
    }),
  );
  expectStatus(consentPage, 200, 'consent page');
  expectStatus(
    await capture('consent: allow', 'oidc', () =>
      http.inject({
        method: 'POST',
        url: `${ACTIONS}/consent`,
        payload: new URLSearchParams([
          ['auth_session_id', authSessionId(consentPage)],
          ['decision', 'allow'],
          ['scope', 'openid'],
          ['scope', 'email'],
        ]).toString(),
        headers: { ...FORM, cookie },
      }),
    ),
    302,
    'consent',
  );
  expectStatus(
    await capture('cors preflight', 'oidc', () =>
      http.inject({
        method: 'OPTIONS',
        url: `${OIDC}/token`,
        headers: { origin: 'https://app7.example', 'access-control-request-method': 'POST' },
      }),
    ),
    204,
    'preflight',
  );
  expectStatus(
    await capture('cors preflight, an origin no client allows', 'oidc', () =>
      http.inject({
        method: 'OPTIONS',
        url: `${OIDC}/token`,
        headers: { origin: 'https://stranger.example', 'access-control-request-method': 'POST' },
      }),
    ),
    404,
    'preflight, unknown origin',
  );

  const exchanged = await capture('token: authorization_code', 'oidc', () =>
    http.inject({
      method: 'POST',
      url: `${OIDC}/token`,
      payload: formOf({
        grant_type: 'authorization_code',
        code: codeOf(sso),
        redirect_uri: REDIRECT_URI,
        code_verifier: VERIFIER,
      }),
      headers: { ...FORM, ...basic() },
    }),
  );
  expectStatus(exchanged, 200, 'token');
  const tokens = exchanged.json<Tokens>();

  expectStatus(
    await capture('userinfo', 'oidc', () =>
      http.inject({
        url: `${OIDC}/userinfo`,
        headers: { authorization: `Bearer ${tokens.access_token}` },
      }),
    ),
    200,
    'userinfo',
  );
  expectStatus(
    await capture('introspect', 'oidc', () =>
      http.inject({
        method: 'POST',
        url: `${OIDC}/token/introspect`,
        payload: formOf({ token: tokens.access_token }),
        headers: { ...FORM, ...basic() },
      }),
    ),
    200,
    'introspect',
  );
  expectStatus(
    await capture('introspect: refresh token', 'oidc', () =>
      http.inject({
        method: 'POST',
        url: `${OIDC}/token/introspect`,
        payload: formOf({ token: tokens.refresh_token, token_type_hint: 'refresh_token' }),
        headers: { ...FORM, ...basic() },
      }),
    ),
    200,
    'introspect refresh',
  );

  const refreshed = await capture('token: refresh_token', 'oidc', () =>
    http.inject({
      method: 'POST',
      url: `${OIDC}/token`,
      payload: formOf({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
      headers: { ...FORM, ...basic() },
    }),
  );
  expectStatus(refreshed, 200, 'refresh');
  const rotated = refreshed.json<Tokens>();

  expectStatus(
    await capture('token: client_credentials', 'oidc', () =>
      http.inject({
        method: 'POST',
        url: `${OIDC}/token`,
        payload: formOf({ grant_type: 'client_credentials' }),
        headers: { ...FORM, ...basic() },
      }),
    ),
    200,
    'client_credentials',
  );

  expectStatus(
    await capture('revoke', 'oidc', () =>
      http.inject({
        method: 'POST',
        url: `${OIDC}/revoke`,
        payload: formOf({ token: rotated.refresh_token, token_type_hint: 'refresh_token' }),
        headers: { ...FORM, ...basic() },
      }),
    ),
    200,
    'revoke',
  );

  const confirm = await capture('end-session: asks for confirmation', 'oidc', () =>
    http.inject({
      url: `${OIDC}/logout?${formOf({ id_token_hint: rotated.id_token })}`,
      headers: { cookie },
    }),
  );
  expectStatus(confirm, 200, 'logout');
  const sessionId = /name="session_id" value="([^"]*)"/u.exec(confirm.body)?.[1];
  const csrf = /name="csrf" value="([^"]*)"/u.exec(confirm.body)?.[1];
  if (sessionId !== undefined && csrf !== undefined) {
    await capture('end-session: confirmed', 'oidc', () =>
      http.inject({
        method: 'POST',
        url: `${OIDC}/logout`,
        payload: formOf({ session_id: sessionId, csrf }),
        headers: { ...FORM, cookie },
      }),
    );
  }
}
