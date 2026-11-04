import { createDatabase, MIGRATIONS_DIR, runMigrations, withTenant } from '@odudu/db';
import { type DatabaseHandle } from '@odudu/db';
import { switchCanonical, tenantDomainRepository } from '@odudu/domain-tenant';
import { loadConfig, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { generateSigningKey, signJwt, toPublicJwk, type SigningKeyRecord } from '@odudu/crypto';
import { sql } from 'drizzle-orm';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';

// A tenant that switched its canonical address keeps accepting what it issued
// at the address it left, for the window the switch opened and not a moment
// longer, and the address it left stops offering what a person does there.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.com';
const BASE_HOST = 'id.example.com';
const REDIRECT_URI = 'https://app.example/callback';
const LOGOUT_URI = 'https://app.example/signed-out';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const PASSWORD = 'correct horse battery staple';
const SECRET = 'portal-secret';
const FORM = 'application/x-www-form-urlencoded';
const EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const PAGE = { accept: 'text/html' };

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 5 });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' });
  app = buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger: createLogger(config),
    tls: true,
    publicBaseUrl: BASE,
    trustProxy: false,
    throttle: { limit: 100_000, windowSeconds: 60 },
  });
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app.close();
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  await appDb.close();
  await owner.close();
  await container.stop();
});

interface Tenant {
  name: string;
  id: string;
  username: string;
}

interface Address {
  host: string;
  prefix: string;
  issuer: string;
}

const pathAddress = (t: Tenant): Address => ({
  host: BASE_HOST,
  prefix: `/tenants/${t.name}`,
  issuer: `${BASE}/tenants/${t.name}`,
});
const domainAddress = (host: string): Address => ({ host, prefix: '', issuer: `https://${host}` });

let hostCounter = 0;
const freshHost = (): string => `d${String((hostCounter += 1))}.retired-tests.net`;

async function newTenant(): Promise<Tenant> {
  const name = `ret-${newId()}`;
  const username = `u${newId().slice(-8)}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    clientSecret: SECRET,
    redirectUris: [REDIRECT_URI],
    username,
    password: PASSWORD,
  });
  const tenantId = seeded.tenantId;
  await owner.db.execute(sql`
    update client_oidc_config
       set post_logout_redirect_uris = array[${LOGOUT_URI}]::text[],
           audiences = array['https://api.example']::text[],
           grant_types = grant_types || array[${EXCHANGE}]::text[],
           token_exchange_impersonation_allowed = true
     where tenant_id = ${tenantId}
  `);
  return { name, id: tenantId, username };
}

async function verifiedDomain(
  t: Tenant,
  canonical: boolean,
): Promise<{ host: string; id: string }> {
  const host = freshHost();
  const id = await withTenant(appDb.db, t.id, async (tx) => {
    const domains = tenantDomainRepository(tx);
    const row = await domains.insert({ tenantId: t.id, host, challenge: 'c' });
    await domains.markVerified(t.id, row.id, new Date());
    if (canonical) await domains.setCanonical(t.id, row.id);
    return row.id;
  });
  return { host, id };
}

// Points the tenant at `target` ('path' or a domain row id), as the admin API does.
async function switchTo(t: Tenant, target: string): Promise<void> {
  const outcome = await withTenant(appDb.db, t.id, (tx) =>
    switchCanonical(
      { domains: tenantDomainRepository(tx), base: BASE, tls: true },
      { id: t.id, name: t.name },
      target,
      new Date(),
    ),
  );
  expect(outcome.kind).toBe('switched');
}

// The window a switch opened ending: every retirement of the tenant is over.
async function endWindow(t: Tenant): Promise<void> {
  await owner.db.execute(
    sql`update tenant_issuer_retirements set expires_at = now() - interval '1 second' where tenant_id = ${t.id}`,
  );
}

class Browser {
  readonly cookies = new Map<string, string>();
  readonly at: Address;

  constructor(at: Address) {
    this.at = at;
  }

  async send(
    method: 'GET' | 'POST',
    path: string,
    options: { form?: Record<string, string>; headers?: Record<string, string> } = {},
  ): Promise<LightMyRequestResponse> {
    const res = await app.inject({
      method,
      url: `${this.at.prefix}${path}`,
      headers: {
        host: this.at.host,
        ...(this.cookies.size === 0
          ? {}
          : { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }),
        ...(options.form === undefined ? {} : { 'content-type': FORM }),
        ...options.headers,
      },
      ...(options.form === undefined
        ? {}
        : { payload: new URLSearchParams(options.form).toString() }),
    });
    const raw = res.headers['set-cookie'];
    for (const line of raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]) {
      const [pair = '', ...attributes] = line.split('; ');
      const at = pair.indexOf('=');
      const value = pair.slice(at + 1);
      if (value === '' || attributes.includes('Max-Age=0')) this.cookies.delete(pair.slice(0, at));
      else this.cookies.set(pair.slice(0, at), value);
    }
    return res;
  }

  get(path: string, headers?: Record<string, string>) {
    return this.send('GET', path, headers === undefined ? {} : { headers });
  }

  post(path: string, form: Record<string, string>, headers?: Record<string, string>) {
    return this.send('POST', path, { form, ...(headers === undefined ? {} : { headers }) });
  }
}

const unescape = (text: string): string => text.replaceAll('&amp;', '&').replaceAll('&#39;', "'");

function firstForm(body: string): { action: string; fields: Record<string, string> } {
  const action = /<form[^>]*\saction="([^"]*)"/u.exec(body)?.[1];
  if (action === undefined) throw new Error(`no form on the page: ${body.slice(0, 300)}`);
  const fields: Record<string, string> = {};
  for (const m of body.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/gu)) {
    fields[m[1] ?? ''] = unescape(m[2] ?? '');
  }
  return { action: unescape(action), fields };
}

const basic = (id = 'portal', secret = SECRET): Record<string, string> => ({
  authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
});

const authorizeQuery = (extra: Record<string, string> = {}): string =>
  new URLSearchParams({
    response_type: 'code',
    client_id: 'portal',
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 's',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...extra,
  }).toString();

interface Tokens {
  accessToken: string;
  idToken: string;
  grantId: string;
}

const claimsOf = (jwt: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString()) as Record<
    string,
    unknown
  >;

// Signs in at `at` and trades the code for tokens there.
async function codeFlow(t: Tenant, at: Address): Promise<Tokens> {
  const browser = new Browser(at);
  const login = await browser.get(`/protocol/openid-connect/auth?${authorizeQuery()}`);
  expect(login.statusCode).toBe(200);
  const form = firstForm(login.body);
  const landed = await app.inject({
    method: 'POST',
    url: form.action,
    headers: {
      host: at.host,
      'content-type': FORM,
      cookie: [...browser.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
    },
    payload: new URLSearchParams({
      ...form.fields,
      username: t.username,
      password: PASSWORD,
    }).toString(),
  });
  expect(landed.statusCode).toBe(302);
  const code = new URL(String(landed.headers.location)).searchParams.get('code') ?? '';
  const token = await browser.post(
    '/protocol/openid-connect/token',
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: VERIFIER,
    },
    basic(),
  );
  expect(token.statusCode).toBe(200);
  const issued = token.json<{ access_token: string; id_token: string }>();
  const grantId = claimsOf(issued.access_token).grant_id;
  if (typeof grantId !== 'string') throw new Error('the access token names no grant');
  return { accessToken: issued.access_token, idToken: issued.id_token, grantId };
}

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

const userinfo = (at: Address, token: string) =>
  new Browser(at).get('/protocol/openid-connect/userinfo', bearer(token));

async function introspects(at: Address, token: string): Promise<boolean> {
  const res = await new Browser(at).post(
    '/protocol/openid-connect/token/introspect',
    { token },
    basic(),
  );
  expect(res.statusCode).toBe(200);
  return res.json<{ active: boolean }>().active;
}

async function revoked(grantId: string): Promise<boolean> {
  const rows = await owner.db.execute<{ revoked_at: Date | null } & Record<string, unknown>>(
    sql`select revoked_at from token_grants where id = ${grantId}`,
  );
  return rows[0]?.revoked_at !== null;
}

const exchange = (at: Address, subjectToken: string) =>
  new Browser(at).post(
    '/protocol/openid-connect/token',
    {
      grant_type: EXCHANGE,
      subject_token: subjectToken,
      subject_token_type: ACCESS_TOKEN_TYPE,
    },
    basic(),
  );

const authorizeWithHint = (at: Address, hint: string) =>
  new Browser(at).get(`/protocol/openid-connect/auth?${authorizeQuery({ id_token_hint: hint })}`);

const logoutWithHint = (at: Address, hint: string) =>
  new Browser(at).get(
    `/protocol/openid-connect/logout?${new URLSearchParams({
      id_token_hint: hint,
      post_logout_redirect_uri: LOGOUT_URI,
      state: 'bye',
    }).toString()}`,
  );

// A client that authenticates with a key, and an assertion it signs for `audience`.
async function keyedClient(t: Tenant): Promise<(audience: string) => Promise<string>> {
  const generated = await generateSigningKey('ES256', KEK);
  const key: SigningKeyRecord = {
    id: newId(),
    tenantId: t.id,
    kid: generated.kid,
    alg: generated.alg,
    status: 'active',
    publicJwk: generated.publicJwk,
    privateJwkEncrypted: generated.privateJwkEncrypted,
    createdAt: new Date(),
    notAfter: null,
  };
  const jwk = toPublicJwk(key.publicJwk, key.kid, key.alg);
  await seed([
    'client',
    '--tenant',
    t.name,
    '--client-id',
    'keyed',
    '--client-secret',
    'unused-secret',
    '--redirect-uri',
    REDIRECT_URI,
  ]);
  await owner.db.execute(sql`
    update client_oidc_config
       set token_endpoint_auth_method = 'private_key_jwt', jwks = ${JSON.stringify({ keys: [jwk] })}::jsonb
     where client_id = (select id from clients where tenant_id = ${t.id} and client_id = 'keyed')
  `);
  return (audience) =>
    signJwt(
      {
        iss: 'keyed',
        sub: 'keyed',
        aud: audience,
        jti: newId(),
        exp: Math.floor(Date.now() / 1000) + 120,
      },
      { key, kek: KEK },
    );
}

const revokeWithAssertion = (at: Address, assertion: string) =>
  new Browser(at).post('/protocol/openid-connect/revoke', {
    token: 'nothing-in-particular',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion,
  });

// What a site does with a token minted at the address the tenant then left:
// accepted at the new address while the window is open, refused when it ends.
interface Site {
  readonly name: string;
  readonly inside: (t: Tenant, to: Address, tokens: Tokens) => Promise<void>;
  readonly after: (t: Tenant, to: Address, tokens: Tokens) => Promise<void>;
}

const SITES: Site[] = [
  {
    name: '/userinfo',
    inside: async (_t, to, tokens) => {
      expect((await userinfo(to, tokens.accessToken)).statusCode).toBe(200);
    },
    after: async (_t, to, tokens) => {
      expect((await userinfo(to, tokens.accessToken)).statusCode).toBe(401);
    },
  },
  {
    name: 'introspection',
    inside: async (_t, to, tokens) => {
      expect(await introspects(to, tokens.accessToken)).toBe(true);
    },
    after: async (_t, to, tokens) => {
      expect(await introspects(to, tokens.accessToken)).toBe(false);
    },
  },
  {
    name: 'revocation',
    inside: async (_t, to, tokens) => {
      const res = await new Browser(to).post(
        '/protocol/openid-connect/revoke',
        { token: tokens.accessToken },
        basic(),
      );
      expect(res.statusCode).toBe(200);
      expect(await revoked(tokens.grantId)).toBe(true);
    },
    after: async (_t, to, tokens) => {
      const res = await new Browser(to).post(
        '/protocol/openid-connect/revoke',
        { token: tokens.accessToken },
        basic(),
      );
      expect(res.statusCode).toBe(200);
      expect(await revoked(tokens.grantId)).toBe(false);
    },
  },
  {
    name: 'a token-exchange subject_token',
    inside: async (_t, to, tokens) => {
      expect((await exchange(to, tokens.accessToken)).statusCode).toBe(200);
    },
    after: async (_t, to, tokens) => {
      expect((await exchange(to, tokens.accessToken)).statusCode).toBe(400);
    },
  },
  {
    name: 'an id_token_hint at /authorize',
    inside: async (_t, to, tokens) => {
      const res = await authorizeWithHint(to, tokens.idToken);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<form');
    },
    after: async (_t, to, tokens) => {
      const res = await authorizeWithHint(to, tokens.idToken);
      expect(res.statusCode).toBe(302);
      const location = new URL(String(res.headers.location));
      expect(location.origin + location.pathname).toBe(REDIRECT_URI);
      expect(location.searchParams.get('error')).toBe('invalid_request');
      expect(location.searchParams.get('error_description')).toBe('id_token_hint is not valid');
    },
  },
  {
    name: 'an id_token_hint at logout',
    inside: async (_t, to, tokens) => {
      const res = await logoutWithHint(to, tokens.idToken);
      expect(res.statusCode).toBe(302);
      expect(String(res.headers.location).startsWith(LOGOUT_URI)).toBe(true);
    },
    after: async (_t, to, tokens) => {
      const res = await logoutWithHint(to, tokens.idToken);
      expect(res.statusCode).toBe(200);
      expect(res.headers.location).toBeUndefined();
      expect(res.body).not.toContain(LOGOUT_URI);
    },
  },
];

describe('a token minted at the address a tenant left', () => {
  it.each(SITES.map((site) => [site.name, site] as const))(
    'is accepted by %s inside the window and refused when it ends',
    async (_name, site) => {
      const t = await newTenant();
      const inside = await codeFlow(t, pathAddress(t));
      const after = await codeFlow(t, pathAddress(t));
      const { host, id } = await verifiedDomain(t, false);
      await switchTo(t, id);
      const to = domainAddress(host);

      await site.inside(t, to, inside);
      await endWindow(t);
      await site.after(t, to, after);
    },
    60_000,
  );

  it("is refused for another tenant, whose accepted issuers do not include the first tenant's retired one", async () => {
    const first = await newTenant();
    const second = await newTenant();
    const minted = await codeFlow(first, pathAddress(first));
    const firstDomain = await verifiedDomain(first, false);
    await switchTo(first, firstDomain.id);
    const secondDomain = await verifiedDomain(second, false);
    await switchTo(second, secondDomain.id);

    for (const at of [pathAddress(second), domainAddress(secondDomain.host)]) {
      expect((await userinfo(at, minted.accessToken)).statusCode, at.issuer).toBe(401);
      expect(await introspects(at, minted.accessToken), at.issuer).toBe(false);
    }
    expect((await userinfo(domainAddress(firstDomain.host), minted.accessToken)).statusCode).toBe(
      200,
    );
  }, 60_000);

  it('is accepted as a client assertion audience inside the window and refused when it ends', async () => {
    const t = await newTenant();
    const assertionFor = await keyedClient(t);
    const { host, id } = await verifiedDomain(t, false);
    await switchTo(t, id);
    const to = domainAddress(host);
    const previousEndpoint = `${pathAddress(t).issuer}/protocol/openid-connect/token`;
    const canonicalEndpoint = `${to.issuer}/protocol/openid-connect/token`;

    expect((await revokeWithAssertion(to, await assertionFor(previousEndpoint))).statusCode).toBe(
      200,
    );
    expect((await revokeWithAssertion(to, await assertionFor(canonicalEndpoint))).statusCode).toBe(
      200,
    );
    await endWindow(t);
    expect((await revokeWithAssertion(to, await assertionFor(previousEndpoint))).statusCode).toBe(
      401,
    );
    expect((await revokeWithAssertion(to, await assertionFor(canonicalEndpoint))).statusCode).toBe(
      200,
    );
  }, 60_000);
});

const clientCredentials = (at: Address) =>
  new Browser(at).post(
    '/protocol/openid-connect/token',
    { grant_type: 'client_credentials' },
    basic(),
  );

describe('the path address after a switch to a domain', () => {
  async function switched(): Promise<{ t: Tenant; path: Address; to: Address; tokens: Tokens }> {
    const t = await newTenant();
    const path = pathAddress(t);
    const tokens = await codeFlow(t, path);
    const { host, id } = await verifiedDomain(t, false);
    await switchTo(t, id);
    return { t, path, to: domainAddress(host), tokens };
  }

  it('answers token, userinfo, introspection, revocation, jwks, discovery and logout inside the window', async () => {
    const { path, tokens, to } = await switched();
    const issued = await clientCredentials(path);
    expect(issued.statusCode).toBe(200);
    expect(claimsOf(issued.json<{ access_token: string }>().access_token).iss).toBe(path.issuer);
    expect((await userinfo(path, tokens.accessToken)).statusCode).toBe(200);
    expect(await introspects(path, tokens.accessToken)).toBe(true);
    const jwks = await new Browser(path).get('/protocol/openid-connect/certs');
    expect(jwks.statusCode).toBe(200);
    expect((await logoutWithHint(path, tokens.idToken)).statusCode).toBe(302);
    const revocation = await new Browser(path).post(
      '/protocol/openid-connect/revoke',
      { token: tokens.accessToken },
      basic(),
    );
    expect(revocation.statusCode).toBe(200);

    const discovered = await new Browser(path).get('/.well-known/openid-configuration');
    expect(discovered.json<{ issuer: string }>().issuer).toBe(path.issuer);
    const canonical = await new Browser(to).get('/.well-known/openid-configuration');
    expect(canonical.json<{ issuer: string }>().issuer).toBe(to.issuer);
  }, 60_000);

  it('points authorization, registration, reset and sign-in at the canonical address instead', async () => {
    const { path, to } = await switched();
    const browser = new Browser(path);
    for (const page of [
      () => browser.get(`/protocol/openid-connect/auth?${authorizeQuery()}`, PAGE),
      () => browser.get('/login-actions/registration', PAGE),
      () => browser.get('/login-actions/reset-password', PAGE),
      () => browser.post('/login-actions/authenticate', { username: 'x', password: 'y' }, PAGE),
    ]) {
      const res = await page();
      expect(res.statusCode).toBe(410);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain(`href="${to.issuer}"`);
    }
  });

  it('answers the bare 404 on every path once the window ends', async () => {
    const { t, path, tokens } = await switched();
    await endWindow(t);
    const rests = [
      '/.well-known/openid-configuration',
      '/protocol/openid-connect/token',
      '/protocol/openid-connect/userinfo',
      '/protocol/openid-connect/certs',
      '/protocol/openid-connect/logout',
      '/protocol/openid-connect/auth',
      '/login-actions/registration',
      '/login-actions/reset-password',
    ];
    const first = await new Browser(path).get(rests[0] ?? '', PAGE);
    expect(first.statusCode).toBe(404);
    expect(first.body).toBe('');
    for (const rest of rests) {
      const res = await new Browser(path).get(rest, PAGE);
      expect({ rest, status: res.statusCode, body: res.body }).toEqual({
        rest,
        status: 404,
        body: '',
      });
    }
    expect((await userinfo(path, tokens.accessToken)).statusCode).toBe(404);
    expect((await clientCredentials(path)).statusCode).toBe(404);
  }, 60_000);

  it('serves the canonical address in full after the window', async () => {
    const { t, to } = await switched();
    await endWindow(t);
    const fresh = await codeFlow(t, to);
    expect((await userinfo(to, fresh.accessToken)).statusCode).toBe(200);
  }, 60_000);
});

describe('a domain after the tenant switched back to its path address', () => {
  async function switchedBack(): Promise<{
    t: Tenant;
    path: Address;
    left: Address;
    tokens: Tokens;
  }> {
    const t = await newTenant();
    const { host } = await verifiedDomain(t, true);
    const left = domainAddress(host);
    const tokens = await codeFlow(t, left);
    await switchTo(t, 'path');
    return { t, path: pathAddress(t), left, tokens };
  }

  it('keeps what it issued working at both addresses, each token carrying the issuer it was minted at', async () => {
    const { path, left, tokens } = await switchedBack();

    const atLeft = await clientCredentials(left);
    expect(atLeft.statusCode).toBe(200);
    expect(claimsOf(atLeft.json<{ access_token: string }>().access_token).iss).toBe(left.issuer);
    const atPath = await clientCredentials(path);
    expect(claimsOf(atPath.json<{ access_token: string }>().access_token).iss).toBe(path.issuer);

    expect((await userinfo(left, tokens.accessToken)).statusCode).toBe(200);
    expect((await userinfo(path, tokens.accessToken)).statusCode).toBe(200);
    expect(await introspects(path, tokens.accessToken)).toBe(true);
  }, 60_000);

  it('points authorization at the path address, then answers the bare 404 on every path', async () => {
    const { t, path, left, tokens } = await switchedBack();
    const page = await new Browser(left).get(
      `/protocol/openid-connect/auth?${authorizeQuery()}`,
      PAGE,
    );
    expect(page.statusCode).toBe(410);
    expect(page.body).toContain(`href="${path.issuer}"`);

    await endWindow(t);
    for (const rest of [
      '/.well-known/openid-configuration',
      '/protocol/openid-connect/userinfo',
      '/protocol/openid-connect/auth',
      '/login-actions/registration',
    ]) {
      const res = await new Browser(left).get(rest, PAGE);
      expect({ rest, status: res.statusCode, body: res.body }).toEqual({
        rest,
        status: 404,
        body: '',
      });
    }
    expect((await userinfo(path, tokens.accessToken)).statusCode).toBe(401);
    const fresh = await codeFlow(t, path);
    expect((await userinfo(path, fresh.accessToken)).statusCode).toBe(200);
  }, 60_000);
});

describe('a client registered before a switch', () => {
  it('completes authorize and logout at the new address with the redirect URIs it already had', async () => {
    const t = await newTenant();
    const { host, id } = await verifiedDomain(t, false);
    await switchTo(t, id);
    const to = domainAddress(host);

    const browser = new Browser(to);
    const login = await browser.get(`/protocol/openid-connect/auth?${authorizeQuery()}`);
    expect(login.statusCode).toBe(200);
    const form = firstForm(login.body);
    const landed = await browser.post(form.action, {
      ...form.fields,
      username: t.username,
      password: PASSWORD,
    });
    expect(landed.statusCode).toBe(302);
    const redirect = new URL(String(landed.headers.location));
    expect(redirect.origin + redirect.pathname).toBe(REDIRECT_URI);
    expect(redirect.searchParams.get('iss')).toBe(to.issuer);

    const tokens = await codeFlow(t, to);
    const out = await logoutWithHint(to, tokens.idToken);
    expect(out.statusCode).toBe(302);
    expect(String(out.headers.location).startsWith(LOGOUT_URI)).toBe(true);

    const unregistered = await browser.get(
      `/protocol/openid-connect/auth?${authorizeQuery({ redirect_uri: 'https://elsewhere.example/cb' })}`,
    );
    expect(unregistered.body).not.toContain('<form');
  }, 60_000);
});
