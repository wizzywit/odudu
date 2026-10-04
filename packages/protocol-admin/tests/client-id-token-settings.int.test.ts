import { tenantDocumentSchema } from '@odudu/contracts/admin';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import {
  createPasswordSubject,
  createSignInClient,
  REDIRECT_URI,
  redeemCode,
  signInForTokens,
  submitPassword,
  type SignInClient,
} from '#/testing/sign-in';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const PASSWORD = 'correct horse battery staple';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

interface Setup {
  readonly tenant: { readonly id: string; readonly name: string };
  readonly client: SignInClient;
  readonly username: string;
}

async function setup(settings: Record<string, unknown> = {}): Promise<Setup> {
  const tenant = await fixture.createTenant(`idt-${newId()}`);
  const client = await createSignInClient(fixture, tenant.id);
  const username = `ada-${newId()}`;
  await createPasswordSubject(fixture, tenant.id, username, PASSWORD);
  if (Object.keys(settings).length > 0) {
    const res = await fixture.patchClient(tenant.name, client.id, settings);
    expect(res.statusCode, res.body).toBe(200);
  }
  return { tenant, client, username };
}

function part(jwt: unknown, index: 0 | 1): Record<string, unknown> {
  if (typeof jwt !== 'string') throw new Error('expected a JWT');
  const segment = jwt.split('.')[index] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function sessionCookie(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie'];
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const cookie = values.find((value) => !value.includes('-persistent='))?.split(';')[0];
  if (cookie === undefined) throw new Error('the sign-in set no session cookie');
  return cookie;
}

function authorize(
  s: Setup,
  cookie: string,
  extra: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: s.client.clientId,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...extra,
  });
  return fixture.http.inject({
    url: `/tenants/${s.tenant.name}/protocol/openid-connect/auth?${params.toString()}`,
    headers: { cookie },
  });
}

async function addKey(tenantName: string, alg: string): Promise<string> {
  const token = await fixture.adminToken(tenantName, ['manage-keys']);
  const res = await fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenantName}/keys`,
    headers: { authorization: `Bearer ${token}` },
    payload: { alg },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: string }>().id;
}

describe('id_token_signed_response_alg', () => {
  it('reads a client created without one back as null, with the two other settings off', async () => {
    const s = await setup();
    const token = await fixture.adminToken(s.tenant.name, ['manage-clients']);
    const res = await fixture.http.inject({
      url: `/admin/tenants/${s.tenant.name}/clients/${s.client.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json()).toMatchObject({
      id_token_signed_response_alg: null,
      default_max_age: null,
      require_auth_time: false,
    });
  });

  it('refuses an algorithm the tenant holds no key for, naming the field', async () => {
    const s = await setup();
    for (const alg of ['RS256', 'HS256', 'none']) {
      const res = await fixture.patchClient(s.tenant.name, s.client.id, {
        id_token_signed_response_alg: alg,
      });
      expect(res.statusCode, alg).toBe(400);
      expect(res.json<{ detail: string }>().detail).toContain('id_token_signed_response_alg');
    }
  });

  it('signs the ID token with the client’s algorithm, and the access token as before', async () => {
    const s = await setup();
    const rsa = await addKey(s.tenant.name, 'RS256');
    const res = await fixture.patchClient(s.tenant.name, s.client.id, {
      id_token_signed_response_alg: 'RS256',
    });
    expect(res.statusCode, res.body).toBe(200);

    const tokens = await signInForTokens(fixture, s.tenant.name, s.client, s.username, PASSWORD);
    expect(part(tokens.id_token, 0)).toMatchObject({ alg: 'RS256' });
    expect(part(tokens.access_token, 0)).toMatchObject({ alg: 'ES256' });

    const keys = await fixture.http.inject({
      url: `/tenants/${s.tenant.name}/protocol/openid-connect/certs`,
    });
    const rsaKid = keys
      .json<{ keys: { kid: string; alg: string }[] }>()
      .keys.find((key) => key.alg === 'RS256')?.kid;
    expect(part(tokens.id_token, 0).kid).toBe(rsaKid);
    expect(rsa).toEqual(expect.any(String));
  });

  it('keeps the last key of an algorithm a client signs its ID tokens with from retiring', async () => {
    const s = await setup();
    const rsa = await addKey(s.tenant.name, 'RS256');
    await fixture.patchClient(s.tenant.name, s.client.id, {
      id_token_signed_response_alg: 'RS256',
    });
    const token = await fixture.adminToken(s.tenant.name, ['manage-keys']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${s.tenant.name}/keys/${rsa}/retire`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain(s.client.clientId);
  });
});

describe('require_auth_time', () => {
  it('[OIDC-CORE-2-11] puts auth_time in every ID token once on, and in none of a plain request’s before', async () => {
    const s = await setup();
    const before = await signInForTokens(fixture, s.tenant.name, s.client, s.username, PASSWORD);
    expect(part(before.id_token, 1)).not.toHaveProperty('auth_time');

    await fixture.patchClient(s.tenant.name, s.client.id, { require_auth_time: true });
    const after = await signInForTokens(fixture, s.tenant.name, s.client, s.username, PASSWORD);
    expect(part(after.id_token, 1).auth_time).toEqual(expect.any(Number));
  });

  it('refuses a value that is not a boolean', async () => {
    const s = await setup();
    const res = await fixture.patchClient(s.tenant.name, s.client.id, { require_auth_time: 'yes' });
    expect(res.statusCode).toBe(400);
  });
});

describe('default_max_age', () => {
  // A session's age is the fixture clock's now against the database's own
  // created_at, so each case starts with the two agreeing.
  beforeEach(() => {
    fixture.clock.set(new Date());
  });

  it('reuses an SSO session without one, however old', async () => {
    const s = await setup();
    const login = await submitPassword(
      fixture,
      s.tenant.name,
      s.client.clientId,
      s.username,
      PASSWORD,
    );
    fixture.clock.advance(120_000);
    const again = await authorize(s, sessionCookie(login));
    expect(again.statusCode).toBe(302);
  });

  it('forces a fresh login past it when the request carries no max_age', async () => {
    const s = await setup({ default_max_age: 60 });
    const login = await submitPassword(
      fixture,
      s.tenant.name,
      s.client.clientId,
      s.username,
      PASSWORD,
    );
    const cookie = sessionCookie(login);

    const within = await authorize(s, cookie);
    expect(within.statusCode).toBe(302);
    fixture.clock.advance(120_000);
    const past = await authorize(s, cookie);
    expect(past.statusCode).toBe(200);
    expect(past.body).toContain('name="password"');
  });

  it('gives way to a max_age the request carries', async () => {
    const s = await setup({ default_max_age: 60 });
    const login = await submitPassword(
      fixture,
      s.tenant.name,
      s.client.clientId,
      s.username,
      PASSWORD,
    );
    fixture.clock.advance(120_000);
    const again = await authorize(s, sessionCookie(login), { max_age: '600' });
    expect(again.statusCode).toBe(302);
  });

  it('puts auth_time in an ID token it applied to', async () => {
    const s = await setup({ default_max_age: 600 });
    const login = await submitPassword(
      fixture,
      s.tenant.name,
      s.client.clientId,
      s.username,
      PASSWORD,
    );
    const redeemed = await redeemCode(fixture, s.tenant.name, s.client, login);
    expect(part(redeemed.json<{ id_token: string }>().id_token, 1).auth_time).toEqual(
      expect.any(Number),
    );
  });

  it('refuses a negative or fractional value', async () => {
    const s = await setup();
    for (const value of [-1, 1.5, '60']) {
      const res = await fixture.patchClient(s.tenant.name, s.client.id, { default_max_age: value });
      expect(res.statusCode, String(value)).toBe(400);
    }
  });
});

describe('the three through registration, export and import', () => {
  it('registers, echoes and refuses them as RFC 7591 metadata', async () => {
    const t = await fixture.createTenant(`idt-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
      payload: { client_registration_policy: 'open' },
    });
    const settings = {
      id_token_signed_response_alg: 'ES256',
      default_max_age: 300,
      require_auth_time: true,
    };
    const registered = await fixture.registerClient(t.name, {
      redirect_uris: [REDIRECT_URI],
      ...settings,
    });
    expect(registered.statusCode, registered.body).toBe(201);
    expect(registered.json()).toMatchObject(settings);

    const refused = await fixture.registerClient(t.name, {
      redirect_uris: [REDIRECT_URI],
      id_token_signed_response_alg: 'RS256',
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ error: 'invalid_client_metadata' });
  });

  it('carries them through an export and an import', async () => {
    const s = await setup({
      id_token_signed_response_alg: 'ES256',
      default_max_age: 300,
      require_auth_time: true,
    });
    const operator = await fixture.systemAdminToken(['manage-tenants', 'tenant-admin']);
    const exported = await fixture.http.inject({
      url: `/admin/tenants/${s.tenant.name}/export`,
      headers: { authorization: `Bearer ${operator}` },
    });
    const document = tenantDocumentSchema.parse(exported.json());
    const settings = {
      id_token_signed_response_alg: 'ES256',
      default_max_age: 300,
      require_auth_time: true,
    };
    expect(document.clients[0]).toMatchObject(settings);

    const name = `idt-copy-${newId()}`;
    const imported = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenant-imports',
      headers: { authorization: `Bearer ${operator}` },
      payload: { name, document },
    });
    expect(imported.statusCode, imported.body).toBe(201);
    const listed = await fixture.http.inject({
      url: `/admin/tenants/${name}/clients?client_id=${s.client.clientId}`,
      headers: { authorization: `Bearer ${operator}` },
    });
    expect(listed.json<{ items: unknown[] }>().items[0]).toMatchObject(settings);
  });
});
