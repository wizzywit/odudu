import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { authenticationSessions } from '@odudu/authn-flows';
import {
  generateSigningKey,
  signingKeys,
  signJwt,
  type GeneratedSigningKey,
  type SigningKeyRecord,
} from '@odudu/crypto';
import { clients } from '@odudu/domain-realm';
import { newId } from '@odudu/kernel';
import { eq } from 'drizzle-orm';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
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
const KEK = Buffer.alloc(32, 7);

let realmId: string;
// A second realm, named so that the name itself is markup.
const MARKUP_REALM = 'esc"><script>alert(1)<x';
// The realm's own active signing key, and one that is structurally identical
// but was never given to the realm — the difference between a hint this
// server issued and a hint somebody else minted (OIDC Core §3.1.2.2).
let realmKey: SigningKeyRecord;
let foreignKey: SigningKeyRecord;

function asRecord(generated: GeneratedSigningKey, forRealmId: string): SigningKeyRecord {
  return {
    id: newId(),
    realmId: forRealmId,
    kid: generated.kid,
    alg: generated.alg,
    status: 'active',
    publicJwk: generated.publicJwk,
    privateJwkEncrypted: generated.privateJwkEncrypted,
    createdAt: new Date(),
    notAfter: null,
  };
}

async function issuer(): Promise<string> {
  const res = await http.inject({ url: `/realms/${REALM}/.well-known/openid-configuration` });
  return res.json<{ issuer: string }>().issuer;
}

// An ID Token of the shape /token issues (OIDC Core §2): no `typ` header,
// `aud` the client, `sub` the End-User.
async function mintIdToken(
  claims: { iss: string; sub: string; exp?: number },
  key: SigningKeyRecord = realmKey,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    { aud: CLIENT_ID, iat: now, exp: claims.exp ?? now + 300, iss: claims.iss, sub: claims.sub },
    { key, kek: KEK },
  );
}

// The claims /token gives an access token (RFC 9068 §2.2): `aud` the issuer
// itself rather than the client, plus `client_id` and `jti`. Signed without
// the `at+jwt` of §2.1 unless a caller adds it.
async function accessTokenClaims(sub: string): Promise<Record<string, unknown>> {
  const now = Math.floor(Date.now() / 1000);
  const iss = await issuer();
  return {
    iss,
    sub,
    aud: [iss],
    client_id: CLIENT_ID,
    scope: 'openid',
    iat: now,
    exp: now + 300,
    jti: newId(),
  };
}

async function errorOnRedirect(url: string): Promise<string | null> {
  const res = await http.inject({ url });
  expect(res.statusCode).toBe(302);
  const location = res.headers.location;
  if (typeof location !== 'string') throw new Error('expected a location header');
  return new URL(location).searchParams.get('error');
}

async function countAuthenticationSessions(): Promise<number> {
  const rows = await owner.db
    .select({ id: authenticationSessions.id })
    .from(authenticationSessions)
    .where(eq(authenticationSessions.realmId, realmId));
  return rows.length;
}

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

  realmId = newId();
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

    realmKey = asRecord(await generateSigningKey('ES256', KEK), realmId);
    await tx.insert(signingKeys).values({
      id: realmKey.id,
      realmId,
      kid: realmKey.kid,
      alg: realmKey.alg,
      status: 'active',
      publicJwk: realmKey.publicJwk,
      privateJwkEncrypted: realmKey.privateJwkEncrypted,
    });
  });

  // Never inserted anywhere: a key this server has no record of, standing in
  // for every other issuer's keys at once.
  foreignKey = asRecord(await generateSigningKey('ES256', KEK), realmId);

  // A realm whose own name is markup. The login form interpolates the realm
  // into its `action`, which makes the realm name the one request-derived
  // value that reaches a rendered page at all — see the `escapeHtml` note in
  // view/authorize-html.ts. The payload omits `/` so that the name survives
  // a URL path segment intact.
  const markupClientId = newId();
  const markupRealmId = newId();
  await withRealm(app.db, markupRealmId, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: markupRealmId, name: MARKUP_REALM });
    await tx.insert(clients).values({
      id: markupClientId,
      realmId: markupRealmId,
      clientId: CLIENT_ID,
      name: 'Adversarial test client',
      type: 'confidential',
      secretHash: 'hashed:secret',
    });
    await clientOidcConfigRepository(tx).create({
      clientId: markupClientId,
      realmId: markupRealmId,
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

describe('[RFC6749-3.1-04] a repeated client_id or redirect_uri renders — no location header at all', () => {
  it.each([
    ['client_id', [CLIENT_ID, 'someone-else'] satisfies [string, string]],
    ['redirect_uri', [REDIRECT_URI, 'https://evil.example/cb'] satisfies [string, string]],
  ])('repeated %s', async (key, values) => {
    const res = await http.inject({ url: authorizeUrlWithRepeatedKey(key, values) });
    expect(res.statusCode).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });
});

describe('[RFC6749-3.1-04] a repeated state or scope redirects with invalid_request', () => {
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

describe('an unsupported response_mode is answered with 400 and nothing else', () => {
  it('[OIDC-CORE-3.1.2.6-01] answers response_mode=fragment with 400 and no response parameters', async () => {
    const res = await http.inject({
      url: authorizeUrl({ response_mode: 'fragment', state: 'the-state-value' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers.location).toBeUndefined();
    expect(res.body).not.toContain('name="auth_session_id"');
    // "No error response parameters" is a claim about the whole response,
    // not only about the status line and the Location header: a 400 whose
    // body is a form auto-posting `error` and `state` to the redirect URI
    // would deliver every parameter this clause forbids. Nothing in the
    // response may name the redirect target, carry the request's `state`,
    // or be able to submit anything anywhere.
    expect(res.body).not.toContain(REDIRECT_URI);
    expect(res.body).not.toContain('the-state-value');
    expect(res.body).not.toContain('<form');
    expect(res.body).not.toContain('error=');
  });

  // A repeated response_mode names an unsupported mode as surely as a lone
  // `fragment` does, and is answered the same way rather than falling
  // through to the repeated-parameter rule, which redirects.
  it('answers a repeated response_mode naming fragment with the same bare 400', async () => {
    const res = await http.inject({
      url: authorizeUrlWithRepeatedKey('response_mode', ['query', 'fragment']),
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers.location).toBeUndefined();
    expect(res.body).not.toContain(REDIRECT_URI);
  });

  it('answers a repeated response_mode the same way whichever order it arrives in', async () => {
    const queryFirst = await http.inject({
      url: authorizeUrlWithRepeatedKey('response_mode', ['query', 'fragment']),
    });
    const fragmentFirst = await http.inject({
      url: authorizeUrlWithRepeatedKey('response_mode', ['fragment', 'query']),
    });
    expect(queryFirst.statusCode).toBe(fragmentFirst.statusCode);
    expect(queryFirst.body).toBe(fragmentFirst.body);
  });

  it('answers response_mode=query exactly as a request naming no mode', async () => {
    const res = await http.inject({ url: authorizeUrl({ response_mode: 'query' }) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('name="auth_session_id"');
  });
});

// OIDC Core §3.1.2.6: Odudu implements no request objects (§6), and the
// client has to be told so — a client whose signed parameters were
// discarded in silence would believe they had been honoured.
describe('request objects are refused by name rather than ignored', () => {
  async function errorReturnedFor(key: string): Promise<string | null> {
    const res = await http.inject({ url: authorizeUrl({ [key]: 'https://app.example/req.jwt' }) });
    expect(res.statusCode).toBe(302);
    const location = res.headers.location;
    if (typeof location !== 'string') throw new Error('expected a location header');
    return new URL(location).searchParams.get('error');
  }

  it('[OIDC-CORE-3.1.2.6-02] returns request_not_supported for a request parameter', async () => {
    expect(await errorReturnedFor('request')).toBe('request_not_supported');
  });

  it('[OIDC-CORE-3.1.2.6-03] returns request_uri_not_supported for a request_uri parameter', async () => {
    expect(await errorReturnedFor('request_uri')).toBe('request_uri_not_supported');
  });
});

describe('an empty-valued query parameter behaves as an omitted one', () => {
  it('defaults an empty scope instead of failing it as an unknown one', async () => {
    const res = await http.inject({ url: authorizeUrl({ scope: '' }) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('name="auth_session_id"');
  });

  it('does not echo an empty state back on an error redirect', async () => {
    const res = await http.inject({ url: authorizeUrl({ response_type: 'token', state: '' }) });
    const location = res.headers.location;
    if (typeof location !== 'string') throw new Error('expected a location header');
    expect(new URL(location).searchParams.has('state')).toBe(false);
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

  // A body-less POST does not escape the media-type rule: an empty JSON
  // request is still a request in a representation this endpoint does not
  // take, and answering it with the body parser's own 400 would make the
  // same media type mean two different things.
  it('refuses an empty body in an unsupported media type exactly as a non-empty one', async () => {
    const nonEmpty = await postAuthorizeRaw(JSON.stringify(authorizeParams()), {
      'content-type': 'application/json',
    });
    const empty = await postAuthorizeRaw('', {
      'content-type': 'application/json',
      'content-length': '0',
    });

    expect(empty.statusCode).toBe(nonEmpty.statusCode);
    expect(empty.statusCode).toBe(415);
    expect(empty.headers['content-type']).toBe(nonEmpty.headers['content-type']);
    expect(empty.body).toBe(nonEmpty.body);
  });

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

  // RFC 9110 §8.3: a payload arriving with no Content-Type has an unknown
  // media type. Unknown is unsupported here, and letting it reach Fastify's
  // own FST_ERR_CTP_INVALID_MEDIA_TYPE put back exactly what this endpoint
  // set out to remove — one refusal in two representations, this one a JSON
  // error object where every other refusal is an HTML page.
  it('refuses a body naming no content type exactly as it refuses a named unsupported one', async () => {
    const named = await postAuthorizeRaw(JSON.stringify(authorizeParams()), {
      'content-type': 'application/json',
    });
    const unnamed = await postAuthorizeRaw(JSON.stringify(authorizeParams()), {});

    expect(unnamed.statusCode).toBe(named.statusCode);
    expect(unnamed.statusCode).toBe(415);
    expect(unnamed.headers['content-type']).toBe(named.headers['content-type']);
    expect(unnamed.headers['content-type']).toContain('text/html');
    expect(unnamed.body).toBe(named.body);
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

// OIDC Core §3.1.2.3: "If this parameter [prompt] contains none ... the
// Authorization Server MUST NOT display any authentication or consent user
// interface", and "MUST return an error if an End-User is not already
// authenticated". Nothing in this server reads the session cookie at
// /authorize, so no End-User is ever already authenticated at this point and
// the error is unconditional — which is the behaviour §3.1.2.1 describes,
// arrived at without a session to reuse rather than in spite of one.
describe('prompt=none never authenticates and never shows a page', () => {
  it('[OIDC-CORE-3.1.2.3-01] redirects with login_required rather than rendering anything', async () => {
    const res = await http.inject({ url: authorizeUrl({ prompt: 'none', state: 'xyz 123' }) });

    expect(res.statusCode).toBe(302);
    const location = res.headers.location;
    if (typeof location !== 'string') throw new Error('expected a location header');
    const target = new URL(location);
    expect(target.origin + target.pathname).toBe(REDIRECT_URI);
    expect(target.searchParams.get('error')).toBe('login_required');
    expect(target.searchParams.get('state')).toBe('xyz 123');
    expect(target.searchParams.get('iss')).toBe(await issuer());
  });

  it('[OIDC-CORE-3.1.2.3-02] displays no user interface and starts no authentication session', async () => {
    const before = await countAuthenticationSessions();
    const res = await http.inject({ url: authorizeUrl({ prompt: 'none' }) });

    // No page at all: not a login form, not an error page, nothing with a
    // control on it. A 302 whose body carried the form would still be
    // displaying an authentication user interface.
    expect(res.body).not.toContain('<form');
    expect(res.body).not.toContain('name="auth_session_id"');
    // "Does not interact with the End-User" is a claim about state too: an
    // authentication session parked here is a login this server is waiting
    // to be completed.
    expect(await countAuthenticationSessions()).toBe(before);
  });

  it('answers a POSTed prompt=none exactly as the GET', async () => {
    const getRes = await http.inject({ url: authorizeUrl({ prompt: 'none' }) });
    const postRes = await postAuthorize({ prompt: 'none' });
    expect(postRes.statusCode).toBe(getRes.statusCode);
    expect(postRes.headers.location).toBe(getRes.headers.location);
  });
});

// OIDC Core §3.1.2.1: "If this parameter contains none with any other value,
// an error is returned" — the values are mutually exclusive, and a server
// that honoured one of them would be choosing which half of a contradiction
// the client meant.
describe('[OIDC-CORE-3.1.2.1-07] prompt=none combined with any other value is an error', () => {
  it.each(['none login', 'login none', 'none consent', 'none select_account'])(
    'redirects with invalid_request for prompt=%o',
    async (prompt) => {
      expect(await errorOnRedirect(authorizeUrl({ prompt }))).toBe('invalid_request');
    },
  );

  // The combination is refused as a malformed request, not answered as if
  // the `none` had been sent on its own: login_required here would be this
  // server deciding the contradiction in the client's stead.
  it('does not answer the combination as a bare prompt=none', async () => {
    expect(await errorOnRedirect(authorizeUrl({ prompt: 'none login' }))).not.toBe(
      'login_required',
    );
  });
});

// §3.1.2.1 leaves this a MAY: an unrecognized value may be errored on or
// ignored. Odudu errors, so that a client asking for an interaction this
// server has never heard of is told, rather than answered as though it had
// asked for nothing.
describe('[OIDC-CORE-3.1.2.1-08] an undefined prompt value is refused rather than ignored', () => {
  it.each(['unheard_of', 'login unheard_of', 'Login'])(
    'redirects with invalid_request for prompt=%o',
    async (prompt) => {
      expect(await errorOnRedirect(authorizeUrl({ prompt }))).toBe('invalid_request');
    },
  );

  it.each(['login', 'consent', 'select_account'])('still accepts prompt=%s', async (prompt) => {
    const res = await http.inject({ url: authorizeUrl({ prompt }) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('name="auth_session_id"');
  });
});

// OIDC Core §3.1.2.2: "the OP MUST validate that it was the issuer of that ID
// Token". Signature and `iss`, against the realm's own keys — the same two
// checks /userinfo makes of an access token.
describe('[OIDC-CORE-3.1.2.2-01] an id_token_hint this server did not issue is refused', () => {
  it('refuses a hint that is not a JWT at all', async () => {
    expect(await errorOnRedirect(authorizeUrl({ id_token_hint: 'not.a.jwt' }))).toBe(
      'invalid_request',
    );
  });

  it('refuses a well-formed hint signed by a key this realm does not publish', async () => {
    const hint = await mintIdToken({ iss: await issuer(), sub: newId() }, foreignKey);
    expect(await errorOnRedirect(authorizeUrl({ id_token_hint: hint }))).toBe('invalid_request');
  });

  // The signature alone is not the check: a token minted by this realm's key
  // but claiming another issuer was not issued by this OP either, and a
  // signature-only check would accept it.
  it('refuses a hint signed by this realm but claiming another issuer', async () => {
    const hint = await mintIdToken({ iss: 'https://another.example/realms/acme', sub: newId() });
    expect(await errorOnRedirect(authorizeUrl({ id_token_hint: hint }))).toBe('invalid_request');
  });

  // An access token this realm minted for the same End-User satisfies
  // everything §3.1.2.2 asks about the issuer — this realm's key, this
  // realm's `iss` — and is still not an ID Token. RFC 9068 §2.1 gives it
  // `typ: at+jwt` so the two cannot be confused, which is the distinction
  // /userinfo already relies on in the other direction.
  it('refuses an access token this realm minted for the same subject', async () => {
    const hint = await signJwt(await accessTokenClaims(newId()), {
      key: realmKey,
      kek: KEK,
      typ: 'at+jwt',
    });
    expect(await errorOnRedirect(authorizeUrl({ id_token_hint: hint }))).toBe('invalid_request');
  });

  // The refusal above is the `typ` header and nothing else about the access
  // token's claims: the same payload without it is honoured.
  it('honours the same claims when they carry no at+jwt typ', async () => {
    const hint = await signJwt(await accessTokenClaims(newId()), { key: realmKey, kek: KEK });
    const res = await http.inject({ url: authorizeUrl({ id_token_hint: hint }) });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a hint carrying no sub to identify anybody by', async () => {
    const now = Math.floor(Date.now() / 1000);
    const hint = await signJwt(
      { iss: await issuer(), aud: CLIENT_ID, iat: now, exp: now + 300 },
      { key: realmKey, kek: KEK },
    );
    expect(await errorOnRedirect(authorizeUrl({ id_token_hint: hint }))).toBe('invalid_request');
  });

  it('accepts a hint it did issue and carries on to authentication', async () => {
    const hint = await mintIdToken({ iss: await issuer(), sub: newId() });
    const res = await http.inject({ url: authorizeUrl({ id_token_hint: hint }) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('name="auth_session_id"');
  });

  // Validating the hint comes first: `prompt=none` decides how to answer a
  // request, and a request carrying an unusable hint is not one to answer
  // with the prompt's own error.
  it('refuses an unusable hint under prompt=none as invalid_request, not login_required', async () => {
    expect(
      await errorOnRedirect(authorizeUrl({ prompt: 'none', id_token_hint: 'not.a.jwt' })),
    ).toBe('invalid_request');
  });

  it('still answers prompt=none with login_required when the hint is good', async () => {
    const hint = await mintIdToken({ iss: await issuer(), sub: newId() });
    expect(await errorOnRedirect(authorizeUrl({ prompt: 'none', id_token_hint: hint }))).toBe(
      'login_required',
    );
  });
});

// Every parameter RFC 6749 §4.1.1 defines for the authorization request,
// plus the two RFC 7636 §4.3 adds and OAuth 2.1 makes mandatory. Named as a
// set rather than left implicit in a table, because "validates all the
// OAuth 2.0 parameters" is a claim about a set: a table that quietly lost a
// member would still be green.
const OAUTH_AUTHORIZATION_PARAMETERS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'code_challenge',
  'code_challenge_method',
] as const;

// The error codes an authorization error response may carry: RFC 6749
// §4.1.2.1's seven, and the ones OIDC Core §3.1.2.6 adds. `invalid_client`
// is deliberately absent — it names a client there is no redirect_uri to
// trust, which is answered by rendering rather than by a response parameter.
const AUTHORIZATION_ERROR_CODES = new Set([
  'invalid_request',
  'unauthorized_client',
  'access_denied',
  'unsupported_response_type',
  'invalid_scope',
  'server_error',
  'temporarily_unavailable',
  'interaction_required',
  'login_required',
  'account_selection_required',
  'consent_required',
  'request_not_supported',
  'request_uri_not_supported',
]);

type Answer =
  | { kind: 'redirect'; status: number; target: URL; body: string }
  | { kind: 'form'; status: number; body: string }
  | { kind: 'render'; status: number; body: string };

async function answerTo(url: string): Promise<Answer> {
  const res = await http.inject({ url });
  const location = res.headers.location;
  if (typeof location === 'string') {
    return { kind: 'redirect', status: res.statusCode, target: new URL(location), body: res.body };
  }
  if (res.body.includes('name="auth_session_id"')) {
    return { kind: 'form', status: res.statusCode, body: res.body };
  }
  return { kind: 'render', status: res.statusCode, body: res.body };
}

// A request URL naming a realm that does not exist, built from a valid one
// so that the realm is the only thing wrong with it.
function unknownRealmUrl(): string {
  return authorizeUrl().replace(`/realms/${REALM}/`, `/realms/no-such-realm-${newId()}/`);
}

interface ErrorCase {
  name: string;
  url: () => string | Promise<string>;
}

// Errors reported by rendering: everything above RFC 6749 §4.1.2.1's
// boundary, where no redirect_uri has been established as belonging to a
// real client and sending the user agent anywhere would be an open redirect.
const RENDERED_ERROR_CASES: ErrorCase[] = [
  { name: 'an unknown realm', url: unknownRealmUrl },
  { name: 'an unknown client_id', url: () => authorizeUrl({ client_id: 'no-such-client' }) },
  { name: 'no client_id at all', url: () => authorizeUrl({ client_id: undefined }) },
  {
    name: 'an unregistered redirect_uri',
    url: () => authorizeUrl({ redirect_uri: 'https://evil.example/cb' }),
  },
  { name: 'no redirect_uri at all', url: () => authorizeUrl({ redirect_uri: undefined }) },
  {
    name: 'a repeated client_id',
    url: () => authorizeUrlWithRepeatedKey('client_id', [CLIENT_ID, 'someone-else']),
  },
  {
    name: 'a repeated redirect_uri',
    url: () =>
      authorizeUrlWithRepeatedKey('redirect_uri', [REDIRECT_URI, 'https://evil.example/cb']),
  },
  { name: 'an unsupported response_mode', url: () => authorizeUrl({ response_mode: 'fragment' }) },
  {
    name: 'a repeated response_mode',
    url: () => authorizeUrlWithRepeatedKey('response_mode', ['query', 'fragment']),
  },
  {
    name: 'a repeated response_type',
    url: () => authorizeUrlWithRepeatedKey('response_type', ['code', 'token']),
  },
];

// Errors reported by redirecting: everything below the boundary, where the
// redirect_uri has been matched against the client's registrations and the
// §3.1.2.6 error response is what the client is owed.
// `carriesState` marks the one case that cannot be re-run with a `state` of
// the test's choosing, because sending state twice is the whole of what is
// wrong with it.
const REDIRECTED_ERROR_CASES: (ErrorCase & { error: string; carriesState?: true })[] = [
  {
    name: 'an unsupported response_type',
    error: 'unsupported_response_type',
    url: () => authorizeUrl({ response_type: 'token' }),
  },
  {
    name: 'no response_type at all',
    error: 'unsupported_response_type',
    url: () => authorizeUrl({ response_type: undefined }),
  },
  {
    name: 'a repeated state',
    error: 'invalid_request',
    carriesState: true,
    url: () => authorizeUrlWithRepeatedKey('state', ['first', 'second']),
  },
  {
    name: 'a request object',
    error: 'request_not_supported',
    url: () => authorizeUrl({ request: 'https://app.example/req.jwt' }),
  },
  {
    name: 'a request_uri',
    error: 'request_uri_not_supported',
    url: () => authorizeUrl({ request_uri: 'https://app.example/req.jwt' }),
  },
  {
    name: 'no code_challenge',
    error: 'invalid_request',
    url: () => authorizeUrl({ code_challenge: undefined }),
  },
  {
    name: 'a malformed code_challenge',
    error: 'invalid_request',
    url: () => authorizeUrl({ code_challenge: 'too-short' }),
  },
  {
    name: 'a code_challenge_method of plain',
    error: 'invalid_request',
    url: () => authorizeUrl({ code_challenge_method: 'plain' }),
  },
  {
    name: 'no code_challenge_method',
    error: 'invalid_request',
    url: () => authorizeUrl({ code_challenge_method: undefined }),
  },
  {
    name: 'an unknown scope',
    error: 'invalid_scope',
    url: () => authorizeUrl({ scope: 'openid telepathy' }),
  },
  {
    name: 'an undefined prompt value',
    error: 'invalid_request',
    url: () => authorizeUrl({ prompt: 'unheard_of' }),
  },
  {
    name: 'prompt=none alongside another value',
    error: 'invalid_request',
    url: () => authorizeUrl({ prompt: 'none login' }),
  },
  {
    name: 'an id_token_hint this server did not issue',
    error: 'invalid_request',
    url: () => authorizeUrl({ id_token_hint: 'not.a.jwt' }),
  },
  {
    name: 'prompt=none with nobody authenticated',
    error: 'login_required',
    url: () => authorizeUrl({ prompt: 'none' }),
  },
];

const ALL_ERROR_CASES: ErrorCase[] = [...RENDERED_ERROR_CASES, ...REDIRECTED_ERROR_CASES];

// OIDC Core §3.1.2.2: "the Authorization Server MUST validate all the OAuth
// 2.0 parameters according to the OAuth 2.0 specification". All of them, so
// the set is enumerated and each member is shown to carry a rule of its own
// — a value the endpoint refuses, refused only because of that parameter.
describe('[OIDC-CORE-3.1.2.2-02] every OAuth 2.0 parameter of the request carries a rule', () => {
  const ruled = [
    { parameter: 'response_type', rejected: 'token', kind: 'redirect' as const },
    { parameter: 'client_id', rejected: 'no-such-client', kind: 'render' as const },
    { parameter: 'redirect_uri', rejected: 'https://evil.example/cb', kind: 'render' as const },
    { parameter: 'scope', rejected: 'openid telepathy', kind: 'redirect' as const },
    { parameter: 'code_challenge', rejected: 'too-short', kind: 'redirect' as const },
    { parameter: 'code_challenge_method', rejected: 'plain', kind: 'redirect' as const },
  ];

  it.each(ruled)(
    'refuses the request on $parameter alone',
    async ({ parameter, rejected, kind }) => {
      const refused = await answerTo(authorizeUrl({ [parameter]: rejected }));
      expect(refused.kind).toBe(kind);

      // The same request with this parameter's own value restored is admitted,
      // so the refusal above is attributable to this parameter and nothing else.
      const admitted = await answerTo(authorizeUrl());
      expect(admitted.kind).toBe('form');
    },
  );

  // `state` is the one member of the set with no value the server may
  // refuse: RFC 6749 §4.1.2.1's rule for it is that it comes back exactly as
  // it was sent. Validation here means preserving it, not judging it.
  it('validates state by returning it byte for byte', async () => {
    const state = ' odd value +&=#?/ é… ';
    const answer = await answerTo(authorizeUrl({ response_type: 'token', state }));
    if (answer.kind !== 'redirect') throw new Error('expected a redirect');
    expect(answer.target.searchParams.get('state')).toBe(state);
  });

  it('rules on every OAuth 2.0 parameter the authorization request defines', () => {
    expect([...ruled.map((r) => r.parameter), 'state'].sort()).toEqual(
      [...OAUTH_AUTHORIZATION_PARAMETERS].sort(),
    );
  });
});

// OIDC Core §3.1.2.2: "the Authorization Server MUST verify that all the
// REQUIRED parameters are present and their usage conforms to this
// specification" — two obligations, presence and conformance, held here
// against each parameter that is REQUIRED of a request this server answers.
describe('[OIDC-CORE-3.1.2.2-03] every REQUIRED parameter is checked for presence and for shape', () => {
  const required = [
    { parameter: 'response_type', malformed: 'code id_token' },
    { parameter: 'client_id', malformed: 'no-such-client' },
    { parameter: 'redirect_uri', malformed: 'https://app.example/callback/' },
    { parameter: 'code_challenge', malformed: 'contains spaces and is too short' },
    { parameter: 'code_challenge_method', malformed: 'S512' },
  ];

  it.each(required)('refuses a request with no $parameter', async ({ parameter }) => {
    const answer = await answerTo(authorizeUrl({ [parameter]: undefined }));
    expect(answer.kind).not.toBe('form');
  });

  it.each(required)(
    'refuses a $parameter that does not conform',
    async ({ parameter, malformed }) => {
      const answer = await answerTo(authorizeUrl({ [parameter]: malformed }));
      expect(answer.kind).not.toBe('form');
    },
  );

  // `scope` is REQUIRED of an OpenID Connect Authentication Request, and is
  // the one required parameter whose absence is not an error: RFC 6749 §3.3
  // lets the server resolve an omitted scope to a documented default, and
  // this one resolves to `openid` — the very value §3.1.2.2 asks for. See
  // "The default scope, and the empty parameter value" in rfc6749.md.
  it('resolves an omitted scope to the default rather than refusing the request', async () => {
    const answer = await answerTo(authorizeUrl({ scope: undefined }));
    expect(answer.kind).toBe('form');
  });
});

// OIDC Core §3.1.2.2: "If the Authorization Server encounters any error, it
// MUST return an error response, per §3.1.2.6." Every way this endpoint has
// of failing, swept: each one lands in one of the two shapes §3.1.2.6
// describes, and none of them lands in a third.
describe('[OIDC-CORE-3.1.2.2-04] every error this endpoint has ends in a §3.1.2.6 response', () => {
  it.each(RENDERED_ERROR_CASES)('answers $name with a bare HTTP 400', async ({ url }) => {
    const answer = await answerTo(await url());
    expect(answer.kind).toBe('render');
    expect(answer.status).toBe(400);
    expect(answer.body).not.toContain(REDIRECT_URI);
    expect(answer.body).not.toContain('<form');
  });

  it.each(REDIRECTED_ERROR_CASES)(
    'answers $name with an error redirect carrying $error',
    async ({ url, error }) => {
      const answer = await answerTo(await url());
      if (answer.kind !== 'redirect') throw new Error(`expected a redirect for ${error}`);
      expect(answer.status).toBe(302);
      expect(answer.target.origin + answer.target.pathname).toBe(REDIRECT_URI);
      expect(answer.target.searchParams.get('error')).toBe(error);
      expect(AUTHORIZATION_ERROR_CODES.has(error)).toBe(true);
    },
  );

  it.each(ALL_ERROR_CASES)('never grants, never crashes, on $name', async ({ url }) => {
    const answer = await answerTo(await url());
    expect(answer.kind).not.toBe('form');
    expect(answer.status).toBeLessThan(500);
  });
});

// OIDC Core §3.1.2.6: "error — REQUIRED. Error code." Held against every
// error this endpoint can redirect with, not one of them.
describe('[OIDC-CORE-3.1.2.6-04] every error redirect carries an error code', () => {
  it.each(REDIRECTED_ERROR_CASES)('names the error for $name', async ({ url }) => {
    const answer = await answerTo(await url());
    if (answer.kind !== 'redirect') throw new Error('expected a redirect');
    const error = answer.target.searchParams.get('error');
    expect(error).not.toBeNull();
    expect(AUTHORIZATION_ERROR_CODES.has(error ?? '')).toBe(true);
  });
});

// OIDC Core §3.1.2.6: "state — OAuth 2.0 state value. REQUIRED if the
// Authorization Request included the state parameter." Both halves: echoed
// when it was sent, and not invented when it was not.
describe('[OIDC-CORE-3.1.2.6-05] state comes back exactly when, and only when, it was sent', () => {
  const STATE = 'a state the client will compare';
  const stateless = REDIRECTED_ERROR_CASES.filter((c) => c.carriesState !== true);

  it.each(stateless)('echoes state on the error for $name', async ({ url }) => {
    const sent = await url();
    const answer = await answerTo(`${sent}&state=${encodeURIComponent(STATE)}`);
    if (answer.kind !== 'redirect') throw new Error('expected a redirect');
    expect(answer.target.searchParams.get('state')).toBe(STATE);
  });

  it.each(stateless)('omits state on the error for $name when none was sent', async ({ url }) => {
    const answer = await answerTo(await url());
    if (answer.kind !== 'redirect') throw new Error('expected a redirect');
    expect(answer.target.searchParams.has('state')).toBe(false);
  });

  // A request that sent `state` twice sent no single state value, and the
  // error response still carries exactly one — the client compares it and
  // finds it wanting, which is the right outcome for a request this server
  // has already refused as malformed.
  it('returns a single state for a request that sent two', async () => {
    const answer = await answerTo(authorizeUrlWithRepeatedKey('state', ['first', 'second']));
    if (answer.kind !== 'redirect') throw new Error('expected a redirect');
    expect(answer.target.searchParams.getAll('state')).toHaveLength(1);
    expect(answer.target.searchParams.get('error')).toBe('invalid_request');
  });
});

// OIDC Core §3.1.2.6: the error response parameters are added to the query
// component of the redirection URI. Not the fragment, which the client's
// backend never sees, and not a body.
describe('[OIDC-CORE-3.1.2.6-06] error parameters arrive in the query component', () => {
  it.each(REDIRECTED_ERROR_CASES)(
    'puts the error for $name in the query, not the fragment',
    async ({ url }) => {
      const answer = await answerTo(await url());
      if (answer.kind !== 'redirect') throw new Error('expected a redirect');
      expect(answer.target.search).toContain('error=');
      expect(answer.target.hash).toBe('');
      expect(answer.body).toBe('');
    },
  );
});

// RFC 6749 §4.1.2.1 fixes the syntax of all three error-response members:
// `error` and `error_description` are NQSCHAR (printable ASCII less the
// double quote and the backslash), `error_uri` is NQCHAR — the same set
// without the space — and a URI-reference besides. `error` additionally
// comes from the registry: §4.1.2.1's seven codes, plus the extension
// codes §8.5 admits, which is what OIDC Core §3.1.2.6 registered.
describe('[RFC6749-4.1.2.1-05] the members of an authorization error response', () => {
  const NQSCHAR = /^[\x20\x21\x23-\x5B\x5D-\x7E]*$/u;
  const NQCHAR = /^[\x21\x23-\x5B\x5D-\x7E]*$/u;

  it.each(REDIRECTED_ERROR_CASES)('names a registered error code for $name', async ({ url }) => {
    const answer = await answerTo(await url());
    if (answer.kind !== 'redirect') throw new Error('expected a redirect');
    const error = answer.target.searchParams.get('error');
    if (error === null) throw new Error('expected an error parameter');
    expect(AUTHORIZATION_ERROR_CODES.has(error)).toBe(true);
    expect(error).toMatch(NQSCHAR);
  });

  // The two optional members are never emitted, so their character-set
  // rules hold vacuously — and this is what says so out loud, rather than
  // leaving "conforms" resting on an emptiness nobody checks. Should either
  // ever start being populated, the rules are applied to it here.
  it.each(REDIRECTED_ERROR_CASES)(
    'keeps error_description and error_uri inside their character sets for $name',
    async ({ url }) => {
      const answer = await answerTo(await url());
      if (answer.kind !== 'redirect') throw new Error('expected a redirect');

      const description = answer.target.searchParams.get('error_description');
      if (description !== null) expect(description).toMatch(NQSCHAR);

      const uri = answer.target.searchParams.get('error_uri');
      if (uri !== null) {
        expect(uri).toMatch(NQCHAR);
        expect(URL.canParse(uri, 'https://client.invalid/')).toBe(true);
      }
    },
  );
});

// OIDC Core §16.22: a 307 obliges the user agent to repeat the method and
// body of the request it is answering, which for a POSTed authorization
// request would forward the request body to the client's redirection URI.
describe('[OIDC-CORE-16.22-01] the redirect to the redirection URI is never a 307', () => {
  it.each(REDIRECTED_ERROR_CASES)('answers $name with 302', async ({ url }) => {
    const answer = await answerTo(await url());
    if (answer.kind !== 'redirect') throw new Error('expected a redirect');
    expect(answer.status).toBe(302);
  });

  it('answers a POSTed authorization request with 302 as well', async () => {
    const res = await postAuthorize({ response_type: 'token' });
    expect(res.statusCode).toBe(302);
    expect([307, 308]).not.toContain(res.statusCode);
  });
});

// OIDC Core §15.1 makes `display` mandatory to implement "at minimum" by not
// erroring on any defined value. §3.1.2.1 defines four. Each is sent on a
// request that is otherwise admitted, so a rejection caused by the parameter
// would show up as a refusal rather than hide behind an unrelated one.
describe('[OIDC-CORE-15.1-01] every defined display value is accepted', () => {
  it.each(['page', 'popup', 'touch', 'wap'])('admits display=%s', async (display) => {
    const answer = await answerTo(authorizeUrl({ display }));
    expect(answer.kind).toBe('form');
    expect(answer.status).toBe(200);
  });
});

// §15.1 again, for `ui_locales` and `claims_locales`: no value may be an
// error, so the values tried include ones no server could satisfy.
describe('[OIDC-CORE-15.1-02] ui_locales and claims_locales are accepted whatever they ask for', () => {
  const values = ['en', 'fr-CA fr en', 'de-DE', 'zz-ZZ', 'not a language tag at all'];

  it.each(values)('admits ui_locales=%o', async (ui_locales) => {
    expect((await answerTo(authorizeUrl({ ui_locales }))).kind).toBe('form');
  });

  it.each(values)('admits claims_locales=%o', async (claims_locales) => {
    expect((await answerTo(authorizeUrl({ claims_locales }))).kind).toBe('form');
  });

  it('admits both at once', async () => {
    const answer = await answerTo(
      authorizeUrl({ ui_locales: 'fr-CA fr en', claims_locales: 'en' }),
    );
    expect(answer.kind).toBe('form');
  });
});

// §15.1 again, for `acr_values`: an OP that authenticates at one level still
// may not error on a request asking for another.
describe('[OIDC-CORE-15.1-03] acr_values is accepted whatever it asks for', () => {
  it.each(['0', '1', 'urn:mace:incommon:iap:silver', 'urn:unheard-of:level 0'])(
    'admits acr_values=%o',
    async (acr_values) => {
      expect((await answerTo(authorizeUrl({ acr_values }))).kind).toBe('form');
    },
  );
});

// OIDC Core §3.1.2.2: "the Authorization Server MUST ignore" request
// parameters it does not recognize — RFC 6749 §3.1 says the same as a MUST.
// Ignoring is a claim about the whole answer, so the answer is compared with
// the one the same request gets without the parameter, not merely checked
// for not being an error.
describe('[OIDC-CORE-3.1.2.2-06] unrecognized request parameters change nothing', () => {
  it.each([
    ['frobnicate', 'yes'],
    ['x-vendor-hint', 'anything at all'],
    ['code', 'an-authorization-code'],
    ['access_token', 'a-token-the-client-invented'],
  ])('admits a request carrying %s', async (key, value) => {
    const answer = await answerTo(authorizeUrl({ [key]: value }));
    expect(answer.kind).toBe('form');
    expect(answer.status).toBe(200);
  });

  it('answers an erroring request the same way with an unrecognized parameter as without', async () => {
    const withExtra = await answerTo(
      authorizeUrl({ response_type: 'token', state: 's', zzz: '1' }),
    );
    const without = await answerTo(authorizeUrl({ response_type: 'token', state: 's' }));
    if (withExtra.kind !== 'redirect' || without.kind !== 'redirect') {
      throw new Error('expected redirects');
    }
    expect(withExtra.target.toString()).toBe(without.target.toString());
  });

  // Ignoring means not carrying it onward either: an unrecognized parameter
  // is not reflected into the error response the client is handed.
  it('does not reflect an unrecognized parameter into the response', async () => {
    const answer = await answerTo(
      authorizeUrl({ response_type: 'token', smuggled: 'do-not-reflect-me' }),
    );
    if (answer.kind !== 'redirect') throw new Error('expected a redirect');
    expect(answer.target.toString()).not.toContain('do-not-reflect-me');
  });
});

// RFC 6749 §3.1: request and response parameters must not be included more
// than once. The request half is answered above (a repeated client_id or
// redirect_uri renders, anything else redirects with invalid_request); this
// is the response half, which the server owns outright.
describe('[RFC6749-3.1-04] no response parameter is ever sent more than once', () => {
  it.each(REDIRECTED_ERROR_CASES)(
    'sends one of each parameter on the error for $name',
    async ({ url }) => {
      const answer = await answerTo(await url());
      if (answer.kind !== 'redirect') throw new Error('expected a redirect');
      for (const key of new Set(answer.target.searchParams.keys())) {
        expect(answer.target.searchParams.getAll(key)).toHaveLength(1);
      }
    },
  );

  it('sends one state even when the request sent two', async () => {
    const answer = await answerTo(authorizeUrlWithRepeatedKey('state', ['first', 'second']));
    if (answer.kind !== 'redirect') throw new Error('expected a redirect');
    expect(answer.target.searchParams.getAll('state')).toHaveLength(1);
  });
});

// RFC 6749 §3.1.1 and §4.1.1: the authorization code flow's `response_type`
// is `code`, and a missing or unrecognized one takes the §4.1.2.1 error
// path — a redirect carrying `unsupported_response_type`, not a rendered
// page and not a grant.
describe('[RFC6749-3.1.1-01] response_type is code, and nothing else is answered as if it were', () => {
  it('admits response_type=code', async () => {
    expect((await answerTo(authorizeUrl())).kind).toBe('form');
  });

  it.each(['token', 'id_token', 'code token', 'code id_token', 'CODE', 'none', 'unheard_of'])(
    'refuses response_type=%o with unsupported_response_type',
    async (response_type) => {
      const answer = await answerTo(authorizeUrl({ response_type }));
      if (answer.kind !== 'redirect') throw new Error('expected a redirect');
      expect(answer.target.searchParams.get('error')).toBe('unsupported_response_type');
    },
  );

  it('takes the same path when response_type is missing entirely', async () => {
    const answer = await answerTo(authorizeUrl({ response_type: undefined }));
    if (answer.kind !== 'redirect') throw new Error('expected a redirect');
    expect(answer.status).toBe(302);
    expect(answer.target.searchParams.get('error')).toBe('unsupported_response_type');
  });

  it('takes the same path when response_type is sent with an empty value', async () => {
    const answer = await answerTo(authorizeUrl({ response_type: '' }));
    if (answer.kind !== 'redirect') throw new Error('expected a redirect');
    expect(answer.target.searchParams.get('error')).toBe('unsupported_response_type');
  });
});

// RFC 6749 §4.1.1: `client_id` is REQUIRED. With no client there is no
// registration to match a redirect_uri against, so §4.1.2.1 forbids
// redirecting and the answer is rendered.
describe('[RFC6749-4.1.1-01] client_id is required, and a request without one is never redirected', () => {
  it('renders rather than redirecting when client_id is absent', async () => {
    const res = await http.inject({ url: authorizeUrl({ client_id: undefined }) });
    expect(res.statusCode).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  it('renders rather than redirecting when client_id names nobody', async () => {
    const res = await http.inject({ url: authorizeUrl({ client_id: `ghost-${newId()}` }) });
    expect(res.statusCode).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  it('renders when client_id is sent with an empty value, which is an absent one', async () => {
    const res = await http.inject({ url: authorizeUrl({ client_id: '' }) });
    expect(res.statusCode).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });
});

// RFC 6749 §4.1.1: the required parameters are validated before the server
// proceeds — before, in particular, anything is created. A rejected request
// leaves no authentication session parked behind it for anyone to complete.
describe('[RFC6749-4.1.1-02] an invalid authorization request creates nothing', () => {
  it.each(ALL_ERROR_CASES)('parks no authentication session for $name', async ({ url }) => {
    const before = await countAuthenticationSessions();
    await http.inject({ url: await url() });
    expect(await countAuthenticationSessions()).toBe(before);
  });

  it('parks exactly one for a request that is valid', async () => {
    const before = await countAuthenticationSessions();
    const res = await http.inject({ url: authorizeUrl() });
    expect(res.statusCode).toBe(200);
    expect(await countAuthenticationSessions()).toBe(before + 1);
  });
});

// RFC 6749 §3.1.2.3 and OAuth 2.1: the redirection endpoint is selected by
// exact string comparison. Every near miss below is a URI an attacker would
// like a normalizing comparison to accept.
describe('[RFC6749-3.1.2.3-01] redirect_uri is matched by exact string comparison, with no wildcards', () => {
  it.each([
    'https://app.example/callback/',
    'https://app.example/Callback',
    'https://app.example/callback?x=1',
    'https://app.example/callback#frag',
    'https://app.example/callback/../callback',
    'https://app.example:443/callback',
    'https://App.Example/callback',
    'https://app.example.evil.test/callback',
    'https://evil.test/?u=https://app.example/callback',
    'https://app.example/*',
    'https://*.app.example/callback',
    'http://app.example/callback',
  ])('refuses %s without redirecting anywhere', async (redirect_uri) => {
    const res = await http.inject({ url: authorizeUrl({ redirect_uri }) });
    expect(res.statusCode).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  it('accepts the registered string itself', async () => {
    const res = await http.inject({ url: authorizeUrl({ redirect_uri: REDIRECT_URI }) });
    expect(res.statusCode).toBe(200);
  });
});

// RFC 6749 §10.14: received values are sanitized before they are echoed.
// `state` is the one request parameter this server hands back verbatim, so
// it is the one that has to survive the trip without becoming markup.
describe('[RFC6749-10.14-01] a hostile state is returned encoded, never as markup', () => {
  const HOSTILE = '"><script>alert(1)</script>';

  it('percent-encodes the state in the Location header', async () => {
    const res = await http.inject({
      url: authorizeUrl({ response_type: 'token', state: HOSTILE }),
    });
    const location = res.headers.location;
    if (typeof location !== 'string') throw new Error('expected a location header');

    expect(location).not.toContain('<script>');
    expect(location).not.toContain('"');
    expect(location).toContain('%3Cscript%3E');
    // Encoded on the wire, and the client still reads back exactly what it
    // sent: encoding is what makes the echo safe, not a substitute for it.
    expect(new URL(location).searchParams.get('state')).toBe(HOSTILE);
  });

  // Neither page /authorize can render interpolates a request parameter
  // today, so these two hold a property that is currently true by
  // construction rather than by escaping. They are here as the guard that
  // notices the day a parameter starts being reflected — which is when the
  // escaping below stops being the only thing standing between a `state`
  // and the DOM.
  it('renders no page containing the hostile state as markup', async () => {
    for (const url of [
      authorizeUrl({ redirect_uri: 'https://evil.example/cb', state: HOSTILE }),
      `${unknownRealmUrl()}&state=${encodeURIComponent(HOSTILE)}`,
    ]) {
      const res = await http.inject({ url });
      expect(res.statusCode).toBe(400);
      expect(res.body).not.toContain('<script>');
      expect(res.body).not.toContain(HOSTILE);
    }
  });

  it('renders no login form containing the hostile state as markup', async () => {
    const res = await http.inject({ url: authorizeUrl({ state: HOSTILE }) });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('<script>');
    expect(res.body).not.toContain(HOSTILE);
  });

  // The realm name is the one value a request supplies that does reach a
  // rendered page: the login form's `action` is built from it. A realm named
  // in markup is what makes this endpoint's escaping observable at all.
  it('escapes the realm name the login form interpolates into its action', async () => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(authorizeParams())) {
      if (value !== undefined) query.set(key, value);
    }
    const res = await http.inject({
      url: `/realms/${encodeURIComponent(MARKUP_REALM)}/protocol/openid-connect/auth?${query.toString()}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('name="auth_session_id"');
    expect(res.body).not.toContain('<script>');
    expect(res.body).not.toContain(MARKUP_REALM);
    expect(res.body).toContain('&lt;script&gt;');
    expect(res.body).toContain('&quot;&gt;');
  });
});

// RFC 6749 §10.13, carried into OIDC Core §3.1.2.3: a sign-in page an
// attacker can frame is a sign-in page an attacker can overlay, and the
// end-user's click lands on whichever control the invisible frame has
// positioned under the cursor. The countermeasure has to be on every page
// the endpoint renders, not only the one with the form — an error page that
// can be framed is a page an attacker can position and style to convince an
// end-user of something.
//
// The set is enumerated rather than sampled: RENDERED_ERROR_CASES is every
// way this endpoint answers with markup instead of a redirect, plus the
// login form and the 415 the POST refuses an unsupported representation
// with.
describe('[OIDC-CORE-3.1.2.3-05] no page this endpoint renders can be framed', () => {
  function expectRefusesFraming(res: LightMyRequestResponse, what: string): void {
    expect(`${what}: ${String(res.headers['content-type'])}`).toContain('text/html');
    expect(`${what}: ${String(res.headers['content-security-policy'])}`).toContain(
      "frame-ancestors 'none'",
    );
    expect(`${what}: ${String(res.headers['x-frame-options'])}`).toBe(`${what}: DENY`);
  }

  it('refuses framing on the login form', async () => {
    expectRefusesFraming(await http.inject({ url: authorizeUrl() }), 'the login form');
  });

  it('refuses framing on every rendered error page', async () => {
    for (const errorCase of RENDERED_ERROR_CASES) {
      const res = await http.inject({ url: await errorCase.url() });
      expect(`${errorCase.name}: ${String(res.statusCode)}`).toBe(`${errorCase.name}: 400`);
      expectRefusesFraming(res, errorCase.name);
    }
  });

  it('refuses framing on the page that refuses an unsupported representation', async () => {
    const res = await postAuthorizeRaw('{}', { 'content-type': 'application/json' });
    expect(res.statusCode).toBe(415);
    expectRefusesFraming(res, 'the 415 page');
  });
});
