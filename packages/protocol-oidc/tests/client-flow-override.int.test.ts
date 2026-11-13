import { generateTotpSecret } from '@odudu/crypto';
import {
  credentialRepository,
  hashPassword,
  subjectRepository,
  userCredentials,
  users,
} from '@odudu/domain-identity';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { flowRepository, provisionTenant, type FlowStep } from '@odudu/authn-flows';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';
import { noBreachedLookup } from '#/testing/breached-check';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const PASSWORD_ONLY: FlowStep[] = [{ authenticator: 'password', requirement: 'required' }];
const PASSKEY_ONLY: FlowStep[] = [{ authenticator: 'passkey', requirement: 'required' }];

interface Tenant {
  name: string;
  id: string;
  staff: string;
  keyOnly: string;
  clientDbIds: Map<string, string>;
}

// One tenant on the default flow (a password, then a code from the app for
// whoever has one), a person who holds both, and three clients: one that
// names no flow, one that names a password-only flow, and one that names a
// flow no sign-in can start.
async function setupTenant(name: string): Promise<Tenant> {
  const id = newId();
  const clientDbIds = new Map<string, string>();
  const flows = await withTenant(app.db, id, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id, name });
    await provisionTenant(tx, id);
    const repository = flowRepository(tx);
    const staff = await repository.create(id, 'staff', PASSWORD_ONLY);
    const keyOnly = await repository.create(id, 'key-only', PASSKEY_ONLY);
    for (const [clientId, flowId] of [
      ['plain', undefined],
      ['staff-app', staff.id],
      ['key-app', keyOnly.id],
    ] as const) {
      const clientDbId = newId();
      clientDbIds.set(clientId, clientDbId);
      await tx.insert(clients).values({
        id: clientDbId,
        tenantId: id,
        clientId,
        name: clientId,
        type: 'public',
      });
      await provisionClientDefaults(tx, clientDbId);
      await clientOidcConfigRepository(tx).create({
        clientId: clientDbId,
        tenantId: id,
        redirectUris: [REDIRECT_URI],
        grantTypes: ['authorization_code'],
        tokenEndpointAuthMethod: 'none',
        audiences: [],
        accessTokenTtlSeconds: 300,
        refreshTokenTtlSeconds: 1_209_600,
        ...(flowId === undefined ? {} : { flowId }),
      });
    }
    const subject = await subjectRepository(tx).create({ tenantId: id, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId: id, username: USERNAME });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId: id,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(PASSWORD) },
    });
    await credentialRepository(tx).insert({
      tenantId: id,
      subjectId: subject.id,
      type: 'totp',
      secret: { kind: 'totp', secret: generateTotpSecret(), digits: 6, lastStep: 0 },
    });
    await credentialRepository(tx).insert({
      tenantId: id,
      subjectId: subject.id,
      type: 'recovery-code',
      secret: { kind: 'recovery-code', hash: await hashPassword('saved-code') },
    });
    return { staff: staff.id, keyOnly: keyOnly.id };
  });
  return { name, id, ...flows, clientDbIds };
}

function authorizeUrl(tenantName: string, clientId: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz',
    code_challenge: 'a'.repeat(43),
    code_challenge_method: 'S256',
  });
  return `/tenants/${tenantName}/protocol/openid-connect/auth?${params.toString()}`;
}

function locationHeader(res: LightMyRequestResponse): string {
  const location = res.headers.location;
  if (typeof location !== 'string') throw new Error('expected a location header');
  return location;
}

function ssoCookie(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie'];
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const found = values.find((value) => !value.includes('-persistent='))?.split(';')[0];
  if (found === undefined) throw new Error('expected a session cookie');
  return found;
}

async function authorize(tenant: Tenant, clientId: string, cookie?: string) {
  return http.inject({
    url: authorizeUrl(tenant.name, clientId),
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  });
}

function authSessionOf(res: LightMyRequestResponse): string {
  const match = /name="auth_session_id" value="([^"]*)"/.exec(res.body);
  const value = match?.[1];
  if (value === undefined) throw new Error('auth_session_id not found in the login form');
  return value;
}

function submitPassword(tenant: Tenant, authSessionId: string): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'POST',
    url: `/tenants/${tenant.name}/login-actions/authenticate`,
    payload: new URLSearchParams({
      auth_session_id: authSessionId,
      username: USERNAME,
      password: PASSWORD,
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

async function signIn(tenant: Tenant, clientId: string): Promise<LightMyRequestResponse> {
  const form = await authorize(tenant, clientId);
  expect(form.statusCode).toBe(200);
  return submitPassword(tenant, authSessionOf(form));
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(containerHandle.adminUrl), { max: 5 });
  app = appHandle;

  http = Fastify();
  httpApp = http;
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      breachedPasswordCheck: noBreachedLookup,
      tls: false,
      database: app,
      ownerDatabase: owner,
      kek: Buffer.alloc(32, 9),
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
    }),
  );
  await http.ready();
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('two clients of one tenant on different flows', () => {
  it('ask for different steps after the same password', async () => {
    const tenant = await setupTenant(`flows-${newId()}`);

    const onDefault = await signIn(tenant, 'plain');
    expect(onDefault.statusCode).toBe(200);
    expect(onDefault.body).toContain('name="code"');

    const onStaff = await signIn(tenant, 'staff-app');
    expect(onStaff.statusCode).toBe(302);
    expect(new URL(locationHeader(onStaff)).searchParams.get('code')).not.toBeNull();
  });

  it('answers login_required for a client whose flow no sign-in can start, as for a tenant with none', async () => {
    const tenant = await setupTenant(`flows-${newId()}`);
    const res = await authorize(tenant, 'key-app');
    expect(res.statusCode).toBe(302);
    expect(new URL(locationHeader(res)).searchParams.get('error')).toBe('login_required');

    expect((await authorize(tenant, 'plain')).statusCode).toBe(200);
  });

  it('reuse a single sign-on session only where the session satisfies the flow of the client', async () => {
    const tenant = await setupTenant(`flows-${newId()}`);
    const cookie = ssoCookie(await signIn(tenant, 'staff-app'));

    const again = await authorize(tenant, 'staff-app', cookie);
    expect(again.statusCode).toBe(302);
    expect(new URL(locationHeader(again)).searchParams.get('code')).not.toBeNull();

    const other = await authorize(tenant, 'plain', cookie);
    expect(other.statusCode).toBe(200);
    expect(other.body).toContain('name="auth_session_id"');
  });

  it('keep a sign-in on the flow the client named when it started', async () => {
    const tenant = await setupTenant(`flows-${newId()}`);
    const form = await authorize(tenant, 'staff-app');
    const authSessionId = authSessionOf(form);

    await withTenant(app.db, tenant.id, (tx) =>
      clientOidcConfigRepository(tx).update(tenant.clientDbIds.get('staff-app') ?? '', {
        flowId: null,
      }),
    );

    const submitted = await submitPassword(tenant, authSessionId);
    expect(submitted.statusCode).toBe(302);
    expect(new URL(locationHeader(submitted)).searchParams.get('code')).not.toBeNull();
    expect((await signIn(tenant, 'staff-app')).statusCode).toBe(200);
  });
});
