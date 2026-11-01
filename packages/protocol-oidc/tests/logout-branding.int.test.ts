import { generateSigningKey, signingKeys, signJwt, type SigningKeyRecord } from '@odudu/crypto';
import { hashPassword, subjectRepository, userCredentials, users } from '@odudu/domain-identity';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { provisionTenant } from '@odudu/authn-flows';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId, type BrandingScope, type PageBranding } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';
import { confirmationFields, confirmLogoutPage } from '#/testing/logout-confirmation';

// Which client's theme a logout page wears. The `client_id` of a logout
// request is a parameter anyone can write, so only a client the
// `id_token_hint` verified for is worn, and the confirmation POST wears it
// only when the form's own token says the first contact verified it.

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;
const asked: BrandingScope[] = [];

const CLIENT_ID = 'logout-client';
const REDIRECT_URI = 'https://app.example/callback';
const POST_LOGOUT = 'https://app.example/after-logout';
const PASSWORD = 'correct horse battery staple';
const KEK = Buffer.alloc(32, 11);
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const signingKeyOf = new Map<string, SigningKeyRecord>();

// The page every logout branch renders, marked by whose theme it wears.
function themed(who: string): PageBranding {
  return {
    branding: {
      origin: 'https://id.example.test',
      templates: {
        'logout-confirm': `<div class="${who}">{{form.open}}{{submit}}{{form.close}}</div>`,
        'logged-out': `<div class="${who}">{{message}}{{frames}}{{script}}</div>`,
      },
      tokensCss: '',
      stylesheetUrl: null,
      faviconUrl: null,
      logo: null,
      assetUrls: [],
    },
    templateFallback: () => undefined,
    mail: null,
  };
}

const resolveBranding = (scope: BrandingScope): Promise<PageBranding | null> => {
  asked.push(scope);
  return Promise.resolve(themed(scope.clientId === null ? 'tenant-theme' : 'client-theme'));
};

async function setupTenant(name: string): Promise<{ tenantId: string; clientDbId: string }> {
  const tenantId = newId();
  const clientDbId = newId();
  await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: tenantId, name });
    await provisionTenant(tx, tenantId);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: CLIENT_ID,
      name: 'Logout branding client',
      type: 'public',
    });
    await provisionClientDefaults(tx, clientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      tenantId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      postLogoutRedirectUris: [POST_LOGOUT],
    });
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId, username: 'ada' });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(PASSWORD) },
    });
    const generated = await generateSigningKey('ES256', KEK);
    const key: SigningKeyRecord = {
      id: newId(),
      tenantId,
      kid: generated.kid,
      alg: generated.alg,
      status: 'active',
      publicJwk: generated.publicJwk,
      privateJwkEncrypted: generated.privateJwkEncrypted,
      createdAt: new Date(),
      notAfter: null,
    };
    signingKeyOf.set(name, key);
    await tx.insert(signingKeys).values({
      id: key.id,
      tenantId,
      kid: key.kid,
      alg: key.alg,
      status: 'active',
      publicJwk: key.publicJwk,
      privateJwkEncrypted: key.privateJwkEncrypted,
    });
  });
  return { tenantId, clientDbId };
}

async function mintIdToken(
  tenantName: string,
  sid: string,
  aud: string = CLIENT_ID,
): Promise<string> {
  const key = signingKeyOf.get(tenantName);
  if (key === undefined) throw new Error(`no signing key for ${tenantName}`);
  const configuration = await http.inject({
    url: `/tenants/${tenantName}/.well-known/openid-configuration`,
  });
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: configuration.json<{ issuer: string }>().issuer,
      aud,
      sub: 'someone',
      iat: now,
      exp: now + 300,
      sid,
    },
    { key, kek: KEK },
  );
}

async function signIn(tenantName: string): Promise<{ cookie: string; sessionId: string }> {
  const login = await http.inject({
    url:
      `/tenants/${tenantName}/protocol/openid-connect/auth?` +
      new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: 'openid',
        state: 'xyz',
        code_challenge: CHALLENGE,
        code_challenge_method: 'S256',
      }).toString(),
  });
  const authSessionId = /name="auth_session_id" value="([^"]*)"/.exec(login.body)?.[1] ?? '';
  const submitted = await http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/login-actions/authenticate`,
    payload: new URLSearchParams({
      auth_session_id: authSessionId,
      username: 'ada',
      password: PASSWORD,
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(submitted.statusCode).toBe(302);
  const raw = submitted.headers['set-cookie'];
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const cookie = values.find((value) => !value.includes('-persistent='))?.split(';')[0];
  if (cookie === undefined) throw new Error('no session cookie');
  return { cookie, sessionId: cookie.split('=')[1]?.split(':')[0] ?? '' };
}

const logoutUrl = (tenantName: string, params: Record<string, string> = {}): string =>
  `/tenants/${tenantName}/protocol/openid-connect/logout?${new URLSearchParams(params).toString()}`;

async function clientsAsked(run: () => Promise<LightMyRequestResponse>): Promise<{
  page: LightMyRequestResponse;
  clients: (string | null)[];
}> {
  asked.length = 0;
  const page = await run();
  return { page, clients: asked.map((scope) => scope.clientId) };
}

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
  http = Fastify();
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      tls: false,
      database: app,
      ownerDatabase: owner,
      kek: KEK,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
      resolveBranding,
    }),
  );
  await http.ready();
}, 120_000);

afterAll(async () => {
  await http.close();
  await app.close();
  await owner.close();
  await container.stop();
});

describe('the client a logout page wears', () => {
  it('wears the client the hint verified for on the confirmation, and a redirect asks for no theme', async () => {
    const name = `logout-brand-${newId()}`;
    await setupTenant(name);
    const { cookie, sessionId } = await signIn(name);
    const hint = await mintIdToken(name, sessionId);
    const first = await clientsAsked(() =>
      http.inject({
        url: logoutUrl(name, { id_token_hint: hint, post_logout_redirect_uri: POST_LOGOUT }),
        headers: { cookie },
      }),
    );
    expect(first.clients).toEqual([CLIENT_ID]);
    expect(first.page.body).toContain('class="client-theme"');
    const confirmed = await clientsAsked(() => confirmLogoutPage(http, name, cookie, first.page));
    expect(confirmed.page.statusCode).toBe(302);
    expect(confirmed.clients).toEqual([]);
  });

  it('wears the client on the page that follows a confirmation with no redirect', async () => {
    const name = `logout-brand-${newId()}`;
    await setupTenant(name);
    const { cookie, sessionId } = await signIn(name);
    const hint = await mintIdToken(name, sessionId);
    const first = await http.inject({
      url: logoutUrl(name, { id_token_hint: hint }),
      headers: { cookie },
    });
    const confirmed = await clientsAsked(() => confirmLogoutPage(http, name, cookie, first));
    expect(confirmed.clients).toEqual([CLIENT_ID]);
    expect(confirmed.page.body).toContain('class="client-theme"');
  });

  it('never wears a client named by client_id alone, before or after the confirmation', async () => {
    const name = `logout-brand-${newId()}`;
    await setupTenant(name);
    const { cookie } = await signIn(name);
    const first = await clientsAsked(() =>
      http.inject({ url: logoutUrl(name, { client_id: CLIENT_ID }), headers: { cookie } }),
    );
    expect(first.clients).toEqual([null]);
    expect(first.page.body).toContain('class="tenant-theme"');
    expect(first.page.body).toContain('name="client_id" value="logout-client"');
    const confirmed = await clientsAsked(() => confirmLogoutPage(http, name, cookie, first.page));
    expect(confirmed.clients).toEqual([null]);
    expect(confirmed.page.body).toContain('class="tenant-theme"');
  });

  it('takes the tenant theme for a client_id that is garbage', async () => {
    const name = `logout-brand-${newId()}`;
    await setupTenant(name);
    const { cookie } = await signIn(name);
    const first = await clientsAsked(() =>
      http.inject({ url: logoutUrl(name, { client_id: 'x'.repeat(5000) }), headers: { cookie } }),
    );
    expect(first.clients).toEqual([null]);
  });

  it('takes the tenant theme when client_id disagrees with the hint', async () => {
    const name = `logout-brand-${newId()}`;
    await setupTenant(name);
    const { cookie, sessionId } = await signIn(name);
    const hint = await mintIdToken(name, sessionId);
    const first = await clientsAsked(() =>
      http.inject({
        url: logoutUrl(name, { id_token_hint: hint, client_id: 'someone-else' }),
        headers: { cookie },
      }),
    );
    expect(first.clients).toEqual([null]);
  });

  it('takes the tenant theme when the hint names a client the tenant does not have', async () => {
    const name = `logout-brand-${newId()}`;
    await setupTenant(name);
    const { cookie, sessionId } = await signIn(name);
    const hint = await mintIdToken(name, sessionId, 'ghost');
    const first = await clientsAsked(() =>
      http.inject({ url: logoutUrl(name, { id_token_hint: hint }), headers: { cookie } }),
    );
    expect(first.clients).toEqual([null]);
  });

  it('takes the tenant theme for a disabled client the hint names', async () => {
    const name = `logout-brand-${newId()}`;
    const { clientDbId } = await setupTenant(name);
    const { cookie, sessionId } = await signIn(name);
    const hint = await mintIdToken(name, sessionId);
    await owner.db.update(clients).set({ enabled: false }).where(eq(clients.id, clientDbId));
    const first = await clientsAsked(() =>
      http.inject({ url: logoutUrl(name, { id_token_hint: hint }), headers: { cookie } }),
    );
    expect(first.clients).toEqual([null]);
  });

  it('takes the tenant theme for the page of a request with no session and no hint', async () => {
    const name = `logout-brand-${newId()}`;
    await setupTenant(name);
    const none = await clientsAsked(() => http.inject({ url: logoutUrl(name) }));
    expect(none.clients).toEqual([null]);
    expect(none.page.body).toContain('class="tenant-theme"');
    const named = await clientsAsked(() =>
      http.inject({ url: logoutUrl(name, { client_id: CLIENT_ID }) }),
    );
    expect(named.clients).toEqual([null]);
  });

  it('takes the tenant theme for a confirmation whose token does not match', async () => {
    const name = `logout-brand-${newId()}`;
    await setupTenant(name);
    const { cookie } = await signIn(name);
    const first = await http.inject({
      url: logoutUrl(name, { client_id: CLIENT_ID }),
      headers: { cookie },
    });
    const forged = await clientsAsked(() =>
      http.inject({
        method: 'POST',
        url: `/tenants/${name}/protocol/openid-connect/logout`,
        payload: new URLSearchParams({
          session_id: /name="session_id" value="([^"]*)"/u.exec(first.body)?.[1] ?? '',
          csrf: 'forged',
          client_id: CLIENT_ID,
        }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      }),
    );
    expect(forged.clients).toEqual([null]);
    expect(forged.page.statusCode).toBe(400);
    expect(forged.page.body).toContain('class="tenant-theme"');
  });
});

describe('a hint or a token that proves nothing wears no client', () => {
  const asGet = (name: string, cookie: string, hint: string) =>
    clientsAsked(() =>
      http.inject({ url: logoutUrl(name, { id_token_hint: hint }), headers: { cookie } }),
    );

  it("ignores a hint another tenant's key signed", async () => {
    const name = `logout-brand-${newId()}`;
    const other = `logout-brand-${newId()}`;
    await setupTenant(name);
    await setupTenant(other);
    const { cookie, sessionId } = await signIn(name);
    const foreign = await mintIdToken(other, sessionId);
    expect((await asGet(name, cookie, foreign)).clients).toEqual([null]);
  });

  it('ignores a hint with a tampered signature', async () => {
    const name = `logout-brand-${newId()}`;
    await setupTenant(name);
    const { cookie, sessionId } = await signIn(name);
    const hint = await mintIdToken(name, sessionId);
    // The last base64url character of a signature carries padding bits that
    // decode to the same bytes, so a byte is changed and the change checked.
    const [header, claims, signature = ''] = hint.split('.');
    const bytes = Buffer.from(signature, 'base64url');
    const altered = Buffer.from(bytes);
    altered[0] = (altered[0] ?? 0) ^ 0xff;
    expect(altered.equals(bytes)).toBe(false);
    const flipped = `${header ?? ''}.${claims ?? ''}.${altered.toString('base64url')}`;
    expect((await asGet(name, cookie, flipped)).clients).toEqual([null]);
  });

  it('ignores an unsigned hint', async () => {
    const name = `logout-brand-${newId()}`;
    await setupTenant(name);
    const { cookie, sessionId } = await signIn(name);
    const real = await mintIdToken(name, sessionId);
    const claims = real.split('.')[1] ?? '';
    const header = Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url');
    expect((await asGet(name, cookie, `${header}.${claims}.`)).clients).toEqual([null]);
  });

  describe('a branded token replayed', () => {
    async function branded() {
      const name = `logout-brand-${newId()}`;
      await setupTenant(name);
      const { cookie, sessionId } = await signIn(name);
      const hint = await mintIdToken(name, sessionId);
      const first = await http.inject({
        url: logoutUrl(name, {
          id_token_hint: hint,
          post_logout_redirect_uri: POST_LOGOUT,
          state: 'abc',
        }),
        headers: { cookie },
      });
      expect(first.body).toContain('class="client-theme"');
      return { name, cookie, fields: confirmationFields(first) };
    }

    const post = (name: string, cookie: string, fields: Record<string, string>) =>
      clientsAsked(() =>
        http.inject({
          method: 'POST',
          url: `/tenants/${name}/protocol/openid-connect/logout`,
          payload: new URLSearchParams(fields).toString(),
          headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
        }),
      );

    it.each([
      ['another client_id', { client_id: 'someone-else' }],
      ['an empty client_id', { client_id: '' }],
      ['a changed state', { state: 'other' }],
      ['a changed post_logout_redirect_uri', { post_logout_redirect_uri: 'https://evil.example/' }],
    ])('with %s is refused and wears the tenant theme', async (_label, change) => {
      const { name, cookie, fields } = await branded();
      const replay = await post(name, cookie, { ...fields, ...change });
      expect(replay.page.statusCode).toBe(400);
      expect(replay.clients).toEqual([null]);
      expect(replay.page.body).toContain('class="tenant-theme"');
    });
  });

  it('wears no client for a plain token on a form that carries a verified client_id', async () => {
    const name = `logout-brand-${newId()}`;
    await setupTenant(name);
    const { cookie, sessionId } = await signIn(name);
    const plain = confirmationFields(
      await http.inject({ url: logoutUrl(name, { client_id: CLIENT_ID }), headers: { cookie } }),
    );
    const hint = await mintIdToken(name, sessionId);
    const verified = confirmationFields(
      await http.inject({ url: logoutUrl(name, { id_token_hint: hint }), headers: { cookie } }),
    );
    expect(verified.client_id).toBe(CLIENT_ID);
    expect(plain.csrf).not.toBe(verified.csrf);
    const replay = await clientsAsked(() =>
      http.inject({
        method: 'POST',
        url: `/tenants/${name}/protocol/openid-connect/logout`,
        payload: new URLSearchParams({ ...verified, csrf: plain.csrf ?? '' }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      }),
    );
    expect(replay.page.statusCode).toBe(200);
    expect(replay.clients).toEqual([null]);
    expect(replay.page.body).toContain('class="tenant-theme"');
  });

  it('shows a victim client_id without a hint exactly as a nonexistent one', async () => {
    const name = `logout-brand-${newId()}`;
    await setupTenant(name);
    const { cookie } = await signIn(name);
    const masked = async (clientId: string): Promise<string> =>
      (
        await http.inject({ url: logoutUrl(name, { client_id: clientId }), headers: { cookie } })
      ).body.replace(/value="[^"]*"/gu, 'value="_"');
    expect(await masked(CLIENT_ID)).toBe(await masked('ghost'));
  });
});
