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
const KEK = Buffer.alloc(32, 7);

let realmId: string;
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
