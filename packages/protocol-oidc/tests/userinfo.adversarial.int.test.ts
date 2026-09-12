import { generateSigningKey, signJwt, signingKeyRepository, signingKeys } from '@odudu/crypto';
import { hashPassword, subjectRepository, users } from '@odudu/domain-identity';
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
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { authorizationCodeRepository } from '#/repository/codes';
import { generateAuthorizationCode, hashAuthorizationCode } from '#/service/authorization-code';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const KEK = Buffer.alloc(32, 5);
const REDIRECT_URI = 'https://app.example/callback';

// RFC 7636 Appendix B worked example.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

interface Client {
  clientId: string;
  dbId: string;
  secret: string;
}

interface RealmSetup {
  realmName: string;
  realmId: string;
  issuer: string;
  client: Client;
  subjectId: string;
}

let primary: RealmSetup;
let other: RealmSetup;
let foreignAudience: RealmSetup;

function userinfoUrl(realm: string): string {
  return `/realms/${realm}/protocol/openid-connect/userinfo`;
}

async function setupRealm(label: string, audiences: string[] = []): Promise<RealmSetup> {
  const realmName = `userinfo-${label}-${newId()}`;
  const realmId = newId();

  const clientId = await withRealm(app.db, realmId, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: realmId, name: realmName });

    const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
    await tx.insert(users).values({
      subjectId: subject.id,
      realmId,
      username: `alice-${label}`,
      email: 'alice@example.com',
      emailVerified: true,
    });

    const webAppDbId = newId();
    await tx.insert(clients).values({
      id: webAppDbId,
      realmId,
      clientId: 'web-app',
      name: 'Web app',
      type: 'confidential',
      secretHash: await hashPassword('supersecret'),
    });
    await clientOidcConfigRepository(tx).create({
      clientId: webAppDbId,
      realmId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences,
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });

    const key = await generateSigningKey('RS256', KEK);
    await tx.insert(signingKeys).values({
      id: newId(),
      realmId,
      kid: key.kid,
      alg: key.alg,
      status: 'active',
      publicJwk: key.publicJwk,
      privateJwkEncrypted: key.privateJwkEncrypted,
    });

    return { webAppDbId, subjectId: subject.id };
  });

  return {
    realmName,
    realmId,
    // light-my-request sends `Host: localhost:80`; the scheme's default
    // port is insignificant and never appears in an issuer
    // (packages/protocol-oidc/src/view/issuer.ts).
    issuer: `http://localhost/realms/${realmName}`,
    client: { clientId: 'web-app', dbId: clientId.webAppDbId, secret: 'supersecret' },
    subjectId: clientId.subjectId,
  };
}

function basicAuth(client: Client): string {
  return `Basic ${Buffer.from(`${client.clientId}:${client.secret}`).toString('base64')}`;
}

// Issues an authorization code directly (bypassing /authorize's login UI, as
// the other adversarial suites do) and redeems it through the real /token
// endpoint, returning whatever it issued — an id_token only arrives when
// `scope` includes `openid`.
async function issueTokens(
  realm: RealmSetup,
  scope: string,
): Promise<{ accessToken: string; idToken: string | undefined }> {
  const code = generateAuthorizationCode();
  const codeHash = hashAuthorizationCode(code);

  await withRealm(app.db, realm.realmId, async (tx) => {
    await authorizationCodeRepository(tx).create({
      codeHash,
      realmId: realm.realmId,
      clientId: realm.client.dbId,
      subjectId: realm.subjectId,
      redirectUri: REDIRECT_URI,
      scope,
      nonce: null,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      authTime: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
  });

  const form = new URLSearchParams();
  form.set('grant_type', 'authorization_code');
  form.set('code', code);
  form.set('redirect_uri', REDIRECT_URI);
  form.set('code_verifier', VERIFIER);

  const res = await http.inject({
    method: 'POST',
    url: `/realms/${realm.realmName}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuth(realm.client),
    },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json<{ access_token: string; id_token?: string }>();
  return { accessToken: body.access_token, idToken: body.id_token };
}

async function mintRawAccessToken(
  realm: RealmSetup,
  overrides: {
    iss?: string;
    aud?: string[];
    exp?: number;
    typ?: string;
    scope?: string;
  } = {},
): Promise<string> {
  const key = await withRealm(app.db, realm.realmId, (tx) => signingKeyRepository(tx).active());
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: overrides.iss ?? realm.issuer,
      sub: realm.subjectId,
      aud: overrides.aud ?? [realm.issuer],
      client_id: realm.client.clientId,
      scope: overrides.scope ?? 'openid',
      iat: now,
      exp: overrides.exp ?? now + 300,
      jti: newId(),
    },
    { key, kek: KEK, typ: overrides.typ ?? 'at+jwt' },
  );
}

// Decodes the payload without verifying — used only to inspect what a token
// minted through the real issuance path actually carries, never to make a
// trust decision.
function decodePayload(token: string): Record<string, unknown> {
  const segment = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function tamper(token: string): string {
  const parts = token.split('.');
  const signature = parts[2] ?? '';
  const flipped = signature.startsWith('A') ? 'B' : 'A';
  parts[2] = flipped + signature.slice(1);
  return parts.join('.');
}

// Rewrites a claim in the payload and re-encodes it, leaving the header and
// the signature exactly as the issuer produced them: the modification RFC
// 6750 §5.2's integrity requirement is about, as opposed to a corrupted
// signature over an untouched payload.
function tamperPayload(token: string, claims: Record<string, unknown>): string {
  const parts = token.split('.');
  const payload = { ...decodePayload(token), ...claims };
  parts[1] = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return parts.join('.');
}

interface AuthParam {
  name: string;
  value: string;
}

interface Challenge {
  scheme: string;
  params: AuthParam[];
}

const TOKEN_CHAR = /[A-Za-z0-9!#$%&'*+.^_`|~-]/u;

// RFC 7235 §4.1's challenge, narrowed to the one shape RFC 6750 §3 defines:
// an auth-scheme token followed by a comma-separated list of `name=value`
// auth-params whose value is a token or a quoted-string. The assertions
// below are about that grammar, so they read it rather than matching one
// spelling of it — a challenge that reordered its params, quoted a value
// differently, or padded its separators would still have to satisfy them.
function parseChallenge(raw: string): Challenge {
  let i = 0;

  const skipSpace = (): void => {
    while (raw.charAt(i) === ' ' || raw.charAt(i) === '\t') i++;
  };

  const readToken = (): string => {
    const start = i;
    while (i < raw.length && TOKEN_CHAR.test(raw.charAt(i))) i++;
    if (i === start) throw new Error(`expected a token at offset ${String(i)} of ${raw}`);
    return raw.slice(start, i);
  };

  const readValue = (): string => {
    if (raw.charAt(i) !== '"') return readToken();
    i++;
    let value = '';
    for (;;) {
      const c = raw.charAt(i);
      if (c === '') throw new Error(`unterminated quoted-string in ${raw}`);
      i++;
      if (c === '"') return value;
      if (c === '\\') {
        value += raw.charAt(i);
        i++;
        continue;
      }
      value += c;
    }
  };

  const scheme = readToken();
  const params: AuthParam[] = [];
  skipSpace();

  while (i < raw.length) {
    const name = readToken();
    skipSpace();
    if (raw.charAt(i) !== '=') throw new Error(`expected '=' at offset ${String(i)} of ${raw}`);
    i++;
    skipSpace();
    params.push({ name, value: readValue() });
    skipSpace();
    if (i < raw.length) {
      if (raw.charAt(i) !== ',') throw new Error(`expected ',' at offset ${String(i)} of ${raw}`);
      i++;
      skipSpace();
    }
  }

  return { scheme, params };
}

function challengeOf(res: LightMyRequestResponse): Challenge {
  const header = res.headers['www-authenticate'];
  if (typeof header !== 'string') {
    throw new Error(`expected one WWW-Authenticate header, got ${JSON.stringify(header)}`);
  }
  return parseChallenge(header);
}

// RFC 6750 §3's NQCHAR: printable ASCII less the space, the double quote and
// the backslash. `scope` values and `error_uri` are built from it.
const NQCHAR = /^[\x21\x23-\x5B\x5D-\x7E]+$/u;
// NQSCHAR, the same set with the space admitted — `error` and
// `error_description`.
const NQSCHAR = /^[\x20-\x21\x23-\x5B\x5D-\x7E]*$/u;

const VALUE_RULES = new Map<string, (value: string) => boolean>([
  ['scope', (v) => v.split(' ').every((val) => NQCHAR.test(val))],
  ['error', (v) => NQSCHAR.test(v)],
  ['error_description', (v) => NQSCHAR.test(v)],
  ['error_uri', (v) => NQCHAR.test(v) && URL.canParse(v, 'https://resource.invalid/')],
]);

// Every challenge the endpoint can emit, one per branch of
// packages/protocol-oidc/src/view/routes/userinfo.ts — the only place in
// Odudu that emits a `Bearer` challenge at all. §3's requirements are
// universally quantified over challenges, so the assertions that read them
// are only as strong as this list is complete.
async function everyErrorResponse(): Promise<LightMyRequestResponse[]> {
  const { accessToken } = await issueTokens(primary, 'openid');
  const noCredentials = await userinfo(primary.realmName, null);

  const twoMethods = await postUserinfoRaw(
    primary.realmName,
    formBody({ access_token: accessToken }),
    {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Bearer ${accessToken}`,
    },
  );

  const badToken = await userinfo(primary.realmName, tamper(accessToken));

  const { accessToken: unscoped } = await issueTokens(primary, 'profile email');
  const wrongScope = await userinfo(primary.realmName, unscoped);

  const responses = [noCredentials, twoMethods, badToken, wrongScope];
  // Each of these is a request the endpoint must refuse; *which* refusal each
  // one is belongs to OIDC-CORE-5.3.3-01, which reads §3.1's status codes off
  // this same list. Asserting them here as well would let this helper answer
  // that row's question on its behalf.
  for (const res of responses) expect(res.statusCode).toBeGreaterThanOrEqual(400);
  return responses;
}

async function everyChallenge(): Promise<Challenge[]> {
  return (await everyErrorResponse()).map(challengeOf);
}

async function userinfo(realmName: string, token: string | null): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'GET',
    url: userinfoUrl(realmName),
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  });
}

// OIDC Core §5.3 requires GET and POST alike. This posts what GET carries in
// the Authorization header, in the header still, with no body at all.
function postUserinfo(realmName: string, token: string | null): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'POST',
    url: userinfoUrl(realmName),
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  });
}

function postUserinfoRaw(
  realmName: string,
  payload: string,
  headers: Record<string, string>,
): Promise<LightMyRequestResponse> {
  return http.inject({ method: 'POST', url: userinfoUrl(realmName), headers, payload });
}

function formBody(fields: Record<string, string>): string {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return body.toString();
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
  await http.register(formbody);
  await http.register(oidcRoutes({ database: app, ownerDatabase: owner, kek: KEK }));
  await http.ready();
  httpApp = http;

  primary = await setupRealm('primary');
  other = await setupRealm('other');
  foreignAudience = await setupRealm('foreign-aud', ['https://some-other-api.example']);
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('[RFC6750-3-01] WWW-Authenticate on a request with no credentials', () => {
  it('returns 401 and WWW-Authenticate with no Authorization header, and omits an error code', async () => {
    const res = await userinfo(primary.realmName, null);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/^Bearer/);
    // RFC 6750 §3.1: an error code is omitted entirely when the request
    // carried no authentication information at all — distinct from the
    // `error="invalid_token"` a rejected, present token gets below.
    expect(res.headers['www-authenticate']).not.toMatch(/error=/);
  });
});

describe('the shape of every WWW-Authenticate challenge', () => {
  it('[RFC6750-3-02] names the Bearer auth-scheme and carries at least one auth-param', async () => {
    const challenges = await everyChallenge();
    expect(challenges).toHaveLength(4);
    for (const challenge of challenges) {
      expect(challenge.scheme).toBe('Bearer');
      expect(challenge.params.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('[RFC6750-3-03] never repeats an auth-param name', async () => {
    for (const challenge of await everyChallenge()) {
      const names = challenge.params.map((p) => p.name);
      expect(names).toEqual([...new Set(names)]);
    }
  });

  it('[RFC6750-3-04] keeps every attribute value inside the character set §3 gives it', async () => {
    for (const challenge of await everyChallenge()) {
      for (const { name, value } of challenge.params) {
        const rule = VALUE_RULES.get(name);
        if (rule === undefined) continue;
        expect({ name, value, conforms: rule(value) }).toEqual({ name, value, conforms: true });
      }
    }
  });
});

// OIDC Core §5.3.3: the UserInfo Endpoint's error responses are RFC 6750
// §3's. §3 asks for a `WWW-Authenticate` challenge in the `Bearer` scheme;
// §3.1 fixes which status code each error code is reported with, and says an
// error code is omitted altogether when the request carried no
// authentication information. Held over every error this endpoint has rather
// than over a chosen one, so a branch that answers some other way is a
// failure rather than an omission.
const STATUS_FOR_ERROR = new Map<string | undefined, number>([
  [undefined, 401],
  ['invalid_request', 400],
  ['invalid_token', 401],
  ['insufficient_scope', 403],
]);

describe('[OIDC-CORE-5.3.3-01] the UserInfo Endpoint reports errors the way RFC 6750 §3 does', () => {
  it('answers every failure with a Bearer challenge whose error code carries §3.1’s status', async () => {
    const responses = await everyErrorResponse();
    expect(responses).toHaveLength(4);

    const reported = responses.map((res) => {
      const challenge = challengeOf(res);
      expect(challenge.scheme).toBe('Bearer');
      return {
        error: challenge.params.find((p) => p.name === 'error')?.value,
        status: res.statusCode,
      };
    });

    for (const { error, status } of reported) {
      expect({ error, status }).toEqual({ error, status: STATUS_FOR_ERROR.get(error) });
    }

    // The three §3.1 error codes and the credential-less case are each
    // genuinely exercised, so the mapping above is checked against every
    // entry it has rather than against whichever the endpoint happened to
    // produce four of.
    expect(new Set(reported.map((r) => r.error))).toEqual(new Set(STATUS_FOR_ERROR.keys()));
  });
});

describe('[RFC6750-5.2-01] a modified token is refused', () => {
  it('rejects a token whose payload was rewritten under the issuer’s own signature', async () => {
    const { accessToken } = await issueTokens(primary, 'openid');
    const pristine = await userinfo(primary.realmName, accessToken);
    expect(pristine.statusCode).toBe(200);
    expect(pristine.json<Record<string, unknown>>().sub).toBe(primary.subjectId);

    const modified = tamperPayload(accessToken, { sub: other.subjectId });
    expect(decodePayload(modified).sub).toBe(other.subjectId);

    const res = await userinfo(primary.realmName, modified);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });
});

describe('[RFC6750-3.1-01] 401 invalid_token for a bad, expired or wrong-issuer token', () => {
  it('[RFC9068-4-04] returns 401 invalid_token for an expired token', async () => {
    const expired = await mintRawAccessToken(primary, { exp: Math.floor(Date.now() / 1000) - 60 });
    const res = await userinfo(primary.realmName, expired);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });

  it('[RFC9068-4-02] returns 401 invalid_token for a token minted with the wrong issuer', async () => {
    const foreignIssuer = await mintRawAccessToken(primary, {
      iss: 'https://not-this-realm.example',
    });
    const res = await userinfo(primary.realmName, foreignIssuer);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });

  it('[RFC9068-4-03] returns 401 invalid_token for a tampered signature', async () => {
    const raw = await mintRawAccessToken(primary);
    const res = await userinfo(primary.realmName, tamper(raw));
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });

  it('refuses a token minted by another realm', async () => {
    const { accessToken } = await issueTokens(other, 'openid');
    const res = await userinfo(primary.realmName, accessToken);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });
});

describe('[RFC9068-4-01] rejects a typ other than at+jwt', () => {
  it('refuses an ID token presented as a bearer token', async () => {
    const { idToken } = await issueTokens(primary, 'openid profile email');
    if (idToken === undefined) throw new Error('expected an id_token');
    const res = await userinfo(primary.realmName, idToken);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });
});

describe('[RFC6750-2.1-01] accepts the Authorization header, and RFC6750-2.3 accepts no other method', () => {
  it('succeeds when the token is presented in the Authorization header', async () => {
    const { accessToken } = await issueTokens(primary, 'openid');
    const res = await userinfo(primary.realmName, accessToken);
    expect(res.statusCode).toBe(200);
  });

  it('refuses a token in the query string, with no Authorization header at all', async () => {
    const { accessToken } = await issueTokens(primary, 'openid');
    const res = await http.inject({
      method: 'GET',
      url: `${userinfoUrl(primary.realmName)}?access_token=${accessToken}`,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('[OIDC-CORE-5.3-01] the UserInfo Endpoint answers POST exactly as it answers GET', () => {
  it('returns the same claims for a POST carrying the token in the Authorization header', async () => {
    const { accessToken } = await issueTokens(primary, 'openid profile email');
    const getRes = await userinfo(primary.realmName, accessToken);
    const postRes = await postUserinfo(primary.realmName, accessToken);

    expect(postRes.statusCode).toBe(getRes.statusCode);
    expect(postRes.statusCode).toBe(200);
    expect(postRes.headers['content-type']).toBe(getRes.headers['content-type']);
    expect(postRes.json<Record<string, unknown>>()).toEqual(getRes.json<Record<string, unknown>>());
  });

  it('returns the same credential-less challenge for a POST as for a GET', async () => {
    const getRes = await userinfo(primary.realmName, null);
    const postRes = await postUserinfo(primary.realmName, null);

    expect(postRes.statusCode).toBe(getRes.statusCode);
    expect(postRes.statusCode).toBe(401);
    expect(postRes.headers['www-authenticate']).toBe(getRes.headers['www-authenticate']);
  });

  it('refuses a foreign realm’s token over POST exactly as over GET', async () => {
    const { accessToken } = await issueTokens(other, 'openid');
    const getRes = await userinfo(primary.realmName, accessToken);
    const postRes = await postUserinfo(primary.realmName, accessToken);

    expect(postRes.statusCode).toBe(getRes.statusCode);
    expect(postRes.statusCode).toBe(401);
    expect(postRes.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });
});

describe('[RFC6750-2.2-01] a POST may carry the access token in a form-encoded body', () => {
  it('returns the same claims as the Authorization header does', async () => {
    const { accessToken } = await issueTokens(primary, 'openid profile email');
    const headerRes = await userinfo(primary.realmName, accessToken);
    const bodyRes = await postUserinfoRaw(
      primary.realmName,
      formBody({ access_token: accessToken }),
      { 'content-type': 'application/x-www-form-urlencoded' },
    );

    expect(bodyRes.statusCode).toBe(200);
    expect(bodyRes.json<Record<string, unknown>>()).toEqual(
      headerRes.json<Record<string, unknown>>(),
    );
  });

  it('rejects an invalid token from the body with the same challenge the header gets', async () => {
    const raw = await mintRawAccessToken(primary);
    const bodyRes = await postUserinfoRaw(
      primary.realmName,
      formBody({ access_token: tamper(raw) }),
      {
        'content-type': 'application/x-www-form-urlencoded',
      },
    );

    expect(bodyRes.statusCode).toBe(401);
    expect(bodyRes.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });

  // RFC 6749 §3.1: a parameter sent without a value is an omitted one, so
  // this is a request with no credentials, not one with a bad token.
  it('treats an empty access_token as no credentials at all', async () => {
    const res = await postUserinfoRaw(primary.realmName, formBody({ access_token: '' }), {
      'content-type': 'application/x-www-form-urlencoded',
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).not.toMatch(/error=/);
  });
});

describe('[RFC6750-3.1-03] 400 invalid_request when one request presents the token twice', () => {
  it('refuses a token sent in the Authorization header and the body at once', async () => {
    const { accessToken } = await issueTokens(primary, 'openid');
    const res = await postUserinfoRaw(primary.realmName, formBody({ access_token: accessToken }), {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Bearer ${accessToken}`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_request"/);
  });

  it('refuses a repeated access_token body parameter', async () => {
    const { accessToken } = await issueTokens(primary, 'openid');
    const body = new URLSearchParams();
    body.append('access_token', accessToken);
    body.append('access_token', accessToken);
    const res = await postUserinfoRaw(primary.realmName, body.toString(), {
      'content-type': 'application/x-www-form-urlencoded',
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_request"/);
  });
});

// RFC 6750 §2.2 fixes the form-encoded body method's content type, and
// `/authorize` already answers an unsupported representation with 415
// before any parser runs (packages/protocol-oidc/src/view/routes/authorize.ts).
// The two endpoints share the rule and the media-type test; they differ only
// in what they say, because one answers in HTML and this one in JSON.
describe('[ODUDU-USERINFO-01] a POST body is read only in the form encoding', () => {
  it.each(['application/json', 'text/plain'])('refuses a %s body with 415', async (contentType) => {
    const { accessToken } = await issueTokens(primary, 'openid');
    const res = await postUserinfoRaw(
      primary.realmName,
      JSON.stringify({ access_token: accessToken }),
      { 'content-type': contentType },
    );

    expect(res.statusCode).toBe(415);
  });

  it('accepts a form body that names its charset', async () => {
    const { accessToken } = await issueTokens(primary, 'openid');
    const res = await postUserinfoRaw(primary.realmName, formBody({ access_token: accessToken }), {
      'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
    });

    expect(res.statusCode).toBe(200);
  });

  // A POST naming no content type carries no representation to refuse; it is
  // simply a request whose only credential is the Authorization header.
  it('answers a POST with no content type from the Authorization header alone', async () => {
    const { accessToken } = await issueTokens(primary, 'openid');
    const res = await postUserinfo(primary.realmName, accessToken);

    expect(res.statusCode).toBe(200);
  });
});

describe('[RFC6750-3.1-02] 403 insufficient_scope without the openid scope', () => {
  it('returns 403 and an insufficient_scope challenge', async () => {
    const { accessToken } = await issueTokens(primary, 'profile email');
    const res = await userinfo(primary.realmName, accessToken);
    expect(res.statusCode).toBe(403);
    expect(res.headers['www-authenticate']).toMatch(/error="insufficient_scope"/);
  });
});

// RFC 6749 §7: the resource server validates the access token and "ensures
// that it has not expired and that its scope covers the requested
// resource". Three validations, one row, so all three are held together
// here rather than inferred from three separate refusals: a live token with
// the scope succeeds, and removing either property alone takes it away.
describe('[RFC6749-7-01] the UserInfo Endpoint validates the token, its expiry and its scope', () => {
  it('admits a live token whose scope covers the resource', async () => {
    const { accessToken } = await issueTokens(primary, 'openid');
    const res = await userinfo(primary.realmName, accessToken);
    expect(res.statusCode).toBe(200);
    expect(res.json<Record<string, unknown>>().sub).toBe(primary.subjectId);
  });

  it('refuses a token that does not verify', async () => {
    const { accessToken } = await issueTokens(primary, 'openid');
    const res = await userinfo(primary.realmName, tamper(accessToken));
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });

  it('refuses a token that verifies but has expired', async () => {
    const expired = await mintRawAccessToken(primary, {
      exp: Math.floor(Date.now() / 1000) - 1,
    });
    const res = await userinfo(primary.realmName, expired);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });

  it('refuses a live, verifying token whose scope does not cover this resource', async () => {
    const unscoped = await mintRawAccessToken(primary, { scope: 'profile email' });
    const res = await userinfo(primary.realmName, unscoped);
    expect(res.statusCode).toBe(403);
    expect(res.headers['www-authenticate']).toMatch(/error="insufficient_scope"/);
  });
});

// RFC 6749 §10.3: an access token "cannot be generated, modified, or guessed
// to produce a valid access token by an unauthorized party". All three
// failures, against the one endpoint that spends an access token: a token
// minted by a signer this realm never published, one whose claims were
// rewritten under the issuer's own signature, and one invented outright.
describe('[RFC6749-10.3-01] an access token cannot be generated, modified or guessed', () => {
  it('refuses a token generated by a signer this realm does not publish', async () => {
    const { accessToken } = await issueTokens(other, 'openid');
    // Minted for the same subject this realm would name, so nothing but the
    // signature and the issuer distinguishes it from an acceptable token.
    const res = await userinfo(primary.realmName, accessToken);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });

  it('refuses a token whose claims were modified after issuance', async () => {
    const { accessToken } = await issueTokens(primary, 'openid');
    const res = await userinfo(
      primary.realmName,
      tamperPayload(accessToken, { sub: other.subjectId }),
    );
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });

  it.each([
    'guessed',
    'a.b.c',
    'eyJhbGciOiJub25lIn0.eyJzdWIiOiJhbnlvbmUifQ.',
    Buffer.alloc(32, 9).toString('base64url'),
  ])('refuses the guessed token %o', async (guess) => {
    const res = await userinfo(primary.realmName, guess);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });
});

describe("[OIDC-CORE-5.3.2-01] sub is always present, and an ungranted scope's claims are left out entirely", () => {
  it('omits claims whose scope was not granted', async () => {
    const { accessToken } = await issueTokens(primary, 'openid');
    const res = await userinfo(primary.realmName, accessToken);
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body).toHaveProperty('sub');
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('email_verified');
    expect(body).not.toHaveProperty('name');
  });
});

describe('aud must contain a resource indicator identifying this issuer', () => {
  it('a client configured with a foreign audience still gets a token usable at this issuer, because aud always carries both', async () => {
    const { accessToken } = await issueTokens(foreignAudience, 'openid email');
    const payload = decodePayload(accessToken);
    expect(payload.aud).toEqual(
      expect.arrayContaining(['https://some-other-api.example', foreignAudience.issuer]),
    );

    const res = await userinfo(foreignAudience.realmName, accessToken);
    expect(res.statusCode).toBe(200);
    expect(res.json<Record<string, unknown>>()).toHaveProperty('email');
  });

  it('[RFC9068-4-05] rejects a token whose aud genuinely lacks the issuer, minted directly rather than through mintAccessToken', async () => {
    const raw = await mintRawAccessToken(primary, { aud: ['https://some-other-api.example'] });
    const res = await userinfo(primary.realmName, raw);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });
});

// §5.1's obligation is about the value a client receives, so the proof runs
// end to end: put a non-conforming address on the very row this endpoint
// reads its claims from, then ask the endpoint what it emits. The column
// constraint users_email_addr_spec (packages/db/drizzle/0012_users_email_addr_spec.sql)
// is what makes the answer the conforming address rather than the malformed
// one, on every write path there is rather than the one the repository owns.
describe('[OIDC-CORE-5.1-01] the emitted email claim conforms to RFC 5322 addr-spec', () => {
  it('cannot be made to emit an address the column will not hold', async () => {
    const stored = await withRealm(app.db, primary.realmId, async (tx) => {
      await tx
        .update(users)
        .set({ email: 'alice at example dot com' })
        .where(eq(users.subjectId, primary.subjectId));
    }).then(
      () => true,
      () => false,
    );
    expect(stored).toBe(false);

    const { accessToken } = await issueTokens(primary, 'openid email');
    const res = await userinfo(primary.realmName, accessToken);
    expect(res.statusCode).toBe(200);
    expect(res.json<Record<string, unknown>>().email).toBe('alice@example.com');
  });
});

describe('[OIDC-CORE-5.4-01] claims requested by profile/email are returned from the UserInfo Endpoint', () => {
  it('returns every claim whose scope was granted, as a JSON object', async () => {
    const { accessToken } = await issueTokens(primary, 'openid profile email');
    const res = await userinfo(primary.realmName, accessToken);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    const body = res.json<Record<string, unknown>>();
    expect(body).toMatchObject({
      sub: primary.subjectId,
      name: 'alice-primary',
      email: 'alice@example.com',
      email_verified: true,
    });
  });
});
