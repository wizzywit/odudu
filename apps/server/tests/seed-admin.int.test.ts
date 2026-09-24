import { createDatabase, MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { ADMIN_CLIENT_ID, SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
import { loadConfig, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { type FastifyInstance } from 'fastify';
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

async function authorize(
  instance: FastifyInstance,
  params: Record<string, string>,
): Promise<{ statusCode: number; body: string }> {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: ADMIN_CLIENT_ID,
    scope: 'openid',
    state: 'xyz-123',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...params,
  });
  const res = await instance.inject({
    url: `/tenants/${SYSTEM_TENANT_NAME}/protocol/openid-connect/auth?${query.toString()}`,
  });
  return { statusCode: res.statusCode, body: res.body };
}

describe('the client seed admin bootstraps', () => {
  it('can carry an administrator as far as the login form', async () => {
    await seedAdmin({ username: `ada-${newId()}` });
    const instance = buildTestApp();
    await instance.ready();

    try {
      const res = await authorize(instance, {
        redirect_uri: 'http://127.0.0.1:8080/callback',
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('auth_session_id');
    } finally {
      await instance.close();
    }
  });
});
