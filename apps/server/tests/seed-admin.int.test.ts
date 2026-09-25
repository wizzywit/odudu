import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  type DatabaseHandle,
} from '@odudu/db';
import { ADMIN_CLIENT_ID, SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
import { loadConfig, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seedAdmin } from '#/cli/seed';
import { createLogger } from '#/logger';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let owner: DatabaseHandle;
let appDb: DatabaseHandle;

const KEK = Buffer.alloc(32, 7);
// RFC 7636 Appendix B's worked example.
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(containerHandle.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  appDb = appHandle;

  process.env.ODUDU_DATABASE_URL = containerHandle.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
}, 120_000);

afterAll(async () => {
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

function buildTestApp(): FastifyInstance {
  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' });
  return buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger: createLogger(config),
  });
}

const REDIRECT_URI = 'http://127.0.0.1:8080/callback';
// RFC 7636 Appendix B's worked example, verifier and challenge.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const NEW_PASSWORD = 'Str0ng-Passw0rd!42';

async function authorize(instance: FastifyInstance): Promise<LightMyRequestResponse> {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: ADMIN_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz-123',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  return instance.inject({
    url: `/tenants/${SYSTEM_TENANT_NAME}/protocol/openid-connect/auth?${query.toString()}`,
  });
}

function formPost(
  instance: FastifyInstance,
  url: string,
  fields: Record<string, string>,
): Promise<LightMyRequestResponse> {
  return instance.inject({
    method: 'POST',
    url,
    payload: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

function readField(body: string, name: string): string {
  const match = new RegExp(`name="${name}" value="([^"]*)"`, 'u').exec(body);
  const value = match?.[1];
  if (value === undefined) throw new Error(`${name} not found in the rendered page`);
  return value;
}

// The whole flow an administrator walks: the login form, the password
// change seed admin queues, the code, and the token that code buys.
async function bootstrapAdminToken(
  instance: FastifyInstance,
  username: string,
  password: string,
): Promise<string> {
  const form = await authorize(instance);
  expect(form.statusCode).toBe(200);
  const authSessionId = readField(form.body, 'auth_session_id');

  const login = await formPost(
    instance,
    `/tenants/${SYSTEM_TENANT_NAME}/login-actions/authenticate`,
    { auth_session_id: authSessionId, username, password },
  );
  expect(login.body).toContain('Change your password');
  const changeSessionId = readField(login.body, 'auth_session_id');

  // A completed action hands the parked login back to its first factor,
  // so the new password is what actually signs in.
  const changed = await formPost(
    instance,
    `/tenants/${SYSTEM_TENANT_NAME}/login-actions/required-action?action=update-password`,
    { auth_session_id: changeSessionId, password: NEW_PASSWORD },
  );
  expect(changed.statusCode).toBe(200);

  const signedIn = await formPost(
    instance,
    `/tenants/${SYSTEM_TENANT_NAME}/login-actions/authenticate`,
    {
      auth_session_id: readField(changed.body, 'auth_session_id'),
      username,
      password: NEW_PASSWORD,
    },
  );
  expect(signedIn.statusCode).toBe(302);
  const location = signedIn.headers.location;
  if (typeof location !== 'string') throw new Error('the sign-in did not redirect');
  const code = new URL(location).searchParams.get('code');
  if (code === null) throw new Error(`no code in ${location}`);

  const token = await formPost(
    instance,
    `/tenants/${SYSTEM_TENANT_NAME}/protocol/openid-connect/token`,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: ADMIN_CLIENT_ID,
      code_verifier: VERIFIER,
    },
  );
  expect(token.statusCode).toBe(200);
  return token.json<{ access_token: string }>().access_token;
}

// Runs before anything here has bootstrapped the system tenant, since
// once SYSTEM_TENANT_ID holds the name no foreign id can take it.
describe('seed admin against a system tenant under a foreign id', () => {
  it('refuses rather than colliding on the unique name', async () => {
    const foreignId = newId();
    await owner.db.insert(tenants).values({ id: foreignId, name: SYSTEM_TENANT_NAME });

    try {
      await expect(seedAdmin({ username: `ada-${newId()}` })).rejects.toMatchObject({
        code: 'seed_system_tenant_conflict',
      });
    } finally {
      await owner.db.delete(tenants).where(eq(tenants.id, foreignId));
    }
  });
});

describe('the client seed admin bootstraps', () => {
  it('carries the administrator through to an accepted admin request', async () => {
    const username = `ada-${newId()}`;
    const { password } = await seedAdmin({ username });
    const instance = buildTestApp();
    await instance.ready();

    try {
      const accessToken = await bootstrapAdminToken(instance, username, password);

      const res = await instance.inject({
        method: 'GET',
        url: `/admin/tenants/${SYSTEM_TENANT_NAME}/whoami`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(res.statusCode).toBe(200);
    } finally {
      await instance.close();
    }
  });
});
