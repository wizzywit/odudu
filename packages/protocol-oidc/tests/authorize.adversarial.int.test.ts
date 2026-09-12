import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { clients } from '@odudu/domain-realm';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const REALM = 'acme';
const CLIENT_ID = 'authorize-adversarial-client';
const REDIRECT_URI = 'https://app.example/callback';

function authorizeParams(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    code_challenge: 'a'.repeat(43),
    code_challenge_method: 'S256',
    ...overrides,
  };
}

function authorizeUrl(overrides: Record<string, string | undefined> = {}): string {
  const params = authorizeParams(overrides);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }
  return `/realms/${REALM}/protocol/openid-connect/auth?${query.toString()}`;
}

// OIDC Core §3.1.2 requires the Authorization Endpoint to support both GET
// and POST; this posts the same parameters GET would carry in the query
// string, form-encoded in the body instead, to the same path.
function postAuthorize(overrides: Record<string, string | undefined> = {}) {
  const params = authorizeParams(overrides);
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) body.set(key, value);
  }
  return http.inject({
    method: 'POST',
    url: `/realms/${REALM}/protocol/openid-connect/auth`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: body.toString(),
  });
}

function postAuthorizeRaw(payload: string, headers: Record<string, string>) {
  return http.inject({
    method: 'POST',
    url: `/realms/${REALM}/protocol/openid-connect/auth`,
    headers,
    payload,
  });
}

// Builds a request URL carrying a repeated query key, which authorizeUrl
// (backed by URLSearchParams.set) cannot express.
function authorizeUrlWithRepeatedKey(repeatedKey: string, values: [string, string]): string {
  const base = authorizeUrl();
  const query = new URLSearchParams(base.slice(base.indexOf('?') + 1));
  query.delete(repeatedKey);
  for (const value of values) query.append(repeatedKey, value);
  const path = base.slice(0, base.indexOf('?'));
  return `${path}?${query.toString()}`;
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;

  http = Fastify();
  httpApp = http;
  await http.register(formbody);
  await http.register(
    oidcRoutes({ database: app, ownerDatabase: owner, kek: Buffer.alloc(32, 7) }),
  );
  await http.ready();

  const realmId = newId();
  const clientId = newId();
  await withRealm(app.db, realmId, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: realmId, name: REALM });
    await tx.insert(clients).values({
      id: clientId,
      realmId,
      clientId: CLIENT_ID,
      name: 'Adversarial test client',
      type: 'confidential',
      secretHash: 'hashed:secret',
    });
    await clientOidcConfigRepository(tx).create({
      clientId,
      realmId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });
  });
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('[RFC6749-4.1.2.1-03] emits no location header for an unregistered redirect_uri', () => {
  it('returns 400 with no location header at all', async () => {
    const res = await http.inject({
      url: authorizeUrl({ redirect_uri: 'https://evil.example/cb' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });
});

describe('[RFC6749-4.1.2.1-04] returns state unchanged on a redirected error', () => {
  it('echoes state back exactly, including spaces, on the redirect', async () => {
    const res = await http.inject({
      url: authorizeUrl({ response_type: 'token', state: 'xyz 123' }),
    });
    expect(res.statusCode).toBe(302);
    const location = res.headers.location;
    if (typeof location !== 'string') throw new Error('expected a location header');
    expect(new URL(location).searchParams.get('state')).toBe('xyz 123');
    expect(new URL(location).searchParams.get('error')).toBe('unsupported_response_type');
  });
});

// RFC 9207 §2 puts `iss` on every authorization response, error responses
// included: the mix-up attack it defeats is played out on exactly this
// path, where the attacker steers the victim into a failing request at the
// honest server and has the response delivered as if it came from theirs.
describe('[RFC9207-2-02] an error authorization response carries iss too', () => {
  it('sets iss on the error redirect to the realm discovery issuer', async () => {
    const doc = (
      await http.inject({ url: `/realms/${REALM}/.well-known/openid-configuration` })
    ).json<{ issuer: string }>();
    const res = await http.inject({ url: authorizeUrl({ response_type: 'token' }) });

    expect(res.statusCode).toBe(302);
    const location = res.headers.location;
    if (typeof location !== 'string') throw new Error('expected a location header');
    const returned = new URL(location);
    expect(returned.searchParams.get('error')).toBe('unsupported_response_type');
    expect(returned.searchParams.get('iss')).toBe(doc.issuer);
  });

  it('sets iss on an error redirect carrying no state', async () => {
    const res = await http.inject({
      url: authorizeUrl({ response_type: 'token', state: undefined }),
    });
    const location = res.headers.location;
    if (typeof location !== 'string') throw new Error('expected a location header');
    expect(new URL(location).searchParams.get('iss')).not.toBeNull();
  });
});

describe('a repeated client_id or redirect_uri renders — no location header at all', () => {
  it.each([
    ['client_id', [CLIENT_ID, 'someone-else'] satisfies [string, string]],
    ['redirect_uri', [REDIRECT_URI, 'https://evil.example/cb'] satisfies [string, string]],
  ])('repeated %s', async (key, values) => {
    const res = await http.inject({ url: authorizeUrlWithRepeatedKey(key, values) });
    expect(res.statusCode).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });
});

describe('a repeated state or scope redirects with invalid_request', () => {
  it.each([
    ['state', ['first', 'second'] satisfies [string, string]],
    ['scope', ['openid', 'openid'] satisfies [string, string]],
  ])('repeated %s', async (key, values) => {
    const res = await http.inject({ url: authorizeUrlWithRepeatedKey(key, values) });
    expect(res.statusCode).toBe(302);
    const location = res.headers.location;
    if (typeof location !== 'string') throw new Error('expected a location header');
    expect(new URL(location).searchParams.get('error')).toBe('invalid_request');
  });
});

describe('the success path starts an authentication session and renders the login form', () => {
  it('returns 200 with an HTML form posting to the login-actions handler', async () => {
    const res = await http.inject({ url: authorizeUrl() });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain(`/realms/${REALM}/login-actions/authenticate`);
    expect(res.body).toContain('name="auth_session_id"');
  });
});

describe('[OIDC-CORE-3.1.2-01] POST at the authorization endpoint behaves exactly like GET', () => {
  it('rejects an unregistered redirect_uri with no location header, same as GET', async () => {
    const overrides = { redirect_uri: 'https://evil.example/cb' };
    const getRes = await http.inject({ url: authorizeUrl(overrides) });
    const postRes = await postAuthorize(overrides);

    expect(postRes.statusCode).toBe(getRes.statusCode);
    expect(postRes.statusCode).toBe(400);
    expect(postRes.headers.location).toBeUndefined();
  });

  it('redirects with unsupported_response_type and the same state, same as GET', async () => {
    const overrides = { response_type: 'token', state: 'xyz 123' };
    const getRes = await http.inject({ url: authorizeUrl(overrides) });
    const postRes = await postAuthorize(overrides);

    expect(postRes.statusCode).toBe(getRes.statusCode);
    expect(postRes.statusCode).toBe(302);
    const getLocation = getRes.headers.location;
    const postLocation = postRes.headers.location;
    if (typeof getLocation !== 'string' || typeof postLocation !== 'string') {
      throw new Error('expected a location header');
    }
    expect(new URL(postLocation).searchParams.get('state')).toBe(
      new URL(getLocation).searchParams.get('state'),
    );
    expect(new URL(postLocation).searchParams.get('error')).toBe(
      new URL(getLocation).searchParams.get('error'),
    );
  });

  it('starts an authentication session and renders the same login form, same as GET', async () => {
    const getRes = await http.inject({ url: authorizeUrl() });
    const postRes = await postAuthorize();

    expect(postRes.statusCode).toBe(getRes.statusCode);
    expect(postRes.statusCode).toBe(200);
    expect(postRes.headers['content-type']).toBe(getRes.headers['content-type']);
    expect(postRes.body).toContain(`/realms/${REALM}/login-actions/authenticate`);
    expect(postRes.body).toContain('name="auth_session_id"');
  });

  it('renders what a parameterless GET renders when the body is absent', async () => {
    const getRes = await http.inject({
      url: `/realms/${REALM}/protocol/openid-connect/auth`,
    });
    const postRes = await postAuthorizeRaw('', { 'content-length': '0' });

    expect(postRes.statusCode).toBe(getRes.statusCode);
    expect(postRes.statusCode).toBe(400);
    expect(postRes.headers['content-type']).toBe(getRes.headers['content-type']);
    expect(postRes.body).toBe(getRes.body);
  });

  it('renders what a parameterless GET renders for an empty form body', async () => {
    const getRes = await http.inject({
      url: `/realms/${REALM}/protocol/openid-connect/auth`,
    });
    const postRes = await postAuthorizeRaw('', {
      'content-type': 'application/x-www-form-urlencoded',
    });

    expect(postRes.statusCode).toBe(getRes.statusCode);
    expect(postRes.body).toBe(getRes.body);
  });
});

// OIDC Core §3.1.2.1: POST parameters are form serialized. Any other media
// type is an unsupported representation, so it is refused at the HTTP layer
// before a parser gets to invent values of the wrong type for rules —
// mandatory PKCE above all — that are written for strings.
describe('[OIDC-CORE-3.1.2.1-01] POST at the authorization endpoint takes form encoding only', () => {
  it.each(['application/json', 'text/plain', 'application/xml'])(
    'refuses a %s body with 415 and no redirect',
    async (contentType) => {
      const res = await postAuthorizeRaw(JSON.stringify(authorizeParams()), {
        'content-type': contentType,
      });

      expect(res.statusCode).toBe(415);
      expect(res.headers.location).toBeUndefined();
      expect(res.body).not.toContain('name="auth_session_id"');
    },
  );

  it('accepts a form body that names its charset', async () => {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(authorizeParams())) {
      if (value !== undefined) body.set(key, value);
    }
    const res = await postAuthorizeRaw(body.toString(), {
      'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('name="auth_session_id"');
  });

  it('does not let a JSON body past mandatory PKCE by typing code_challenge as a number', async () => {
    const res = await postAuthorizeRaw(
      JSON.stringify({ ...authorizeParams(), code_challenge: 1234 }),
      { 'content-type': 'application/json' },
    );

    expect(res.statusCode).toBe(415);
    expect(res.body).not.toContain('name="auth_session_id"');
  });
});
