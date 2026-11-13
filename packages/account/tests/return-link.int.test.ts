import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import {
  credentialRepository,
  hashPassword,
  subjectRepository,
  userRepository,
} from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountTestDeps, linkRouteDeps } from '#/testing/support';
import { actionTokenRepository } from '#/repository/action-tokens';
import { tenantSettingsRepository } from '#/repository/tenant-settings';
import { type ActionTokenType, type ReturnTarget } from '#/schema/action-tokens';
import { registerActionTokenRoute } from '#/view/routes/action-token';

let container: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT = newId();
const URI = 'https://app.example/after';
const NEW_PASSWORD = 'a much longer new passphrase';
let registration: { enabled: boolean; redirectUris: readonly string[] } | null = {
  enabled: true,
  redirectUris: [URI, 'https://app.example/other'],
};

beforeAll(async () => {
  container = await startTestDatabase();
  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
  app = appHandle;

  http = Fastify();
  http.register(formbody);
  registerActionTokenRoute(http, {
    ...accountTestDeps,
    ...linkRouteDeps(),
    findHeldSignIn: () => Promise.resolve(null),
    database: app,
    findTenant: (name) => tenantSettingsRepository(owner.db).byName(name),
    findReturnClient: () => Promise.resolve(registration),
  });
  await http.ready();
}, 120_000);

afterAll(async () => {
  await http.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await container?.stop();
});

async function link(
  type: ActionTokenType,
  returnTo: ReturnTarget | undefined,
  ttlSeconds = 3600,
): Promise<{ tenantName: string; key: string }> {
  const tenantId = newId();
  const tenantName = `return-${tenantId.slice(-12)}`;
  await owner.db
    .insert(tenants)
    .values({ id: tenantId, name: tenantName, resetPasswordAllowed: true });
  const key = await withTenant(app.db, tenantId, async (tx) => {
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await userRepository(tx).create({
      subjectId: subject.id,
      tenantId,
      username: 'ada',
      email: 'ada@example.test',
    });
    await credentialRepository(tx).insert({
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secret: { kind: 'password', hash: await hashPassword('correct horse battery') },
    });
    return (
      await actionTokenRepository(tx).issue({
        tenantId,
        subjectId: subject.id,
        type,
        email: 'ada@example.test',
        ...(type === 'execute_actions' ? { actions: ['configure-totp'] } : {}),
        ...(returnTo === undefined ? {} : { returnTo }),
        ttlSeconds,
      })
    ).token;
  });
  return { tenantName, key };
}

function press(tenantName: string, key: string, password?: string) {
  return http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/login-actions/action-token`,
    payload: new URLSearchParams({
      key,
      ...(password === undefined ? {} : { password }),
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

const BACK = `<a href="https://app.example/after?action_status=success">Return to the application</a>`;

describe('a link an administrator issued for a named client', () => {
  it.each([
    ['verify_email', undefined],
    ['reset_password', NEW_PASSWORD],
    ['execute_actions', undefined],
  ] as const)('%s: its last page returns to the registered address', async (type, password) => {
    const { tenantName, key } = await link(type, { clientId: CLIENT, uri: URI });
    const done = await press(tenantName, key, password);
    expect(done.statusCode).toBe(200);
    expect(done.body).toContain(BACK);
  });

  it('offers the way back, marked as an error, on a link that is spent or expired', async () => {
    const spent = await link('verify_email', { clientId: CLIENT, uri: URI });
    await press(spent.tenantName, spent.key);
    const expired = await link('reset_password', { clientId: CLIENT, uri: URI }, -1);
    for (const { tenantName, key } of [spent, expired]) {
      const refused = await press(tenantName, key, NEW_PASSWORD);
      expect(refused.statusCode).toBe(400);
      expect(refused.body).toContain(
        '<a href="https://app.example/after?action_status=error">Return to the application</a>',
      );
    }
  });

  it('is redeemed with no way back once the client is gone, disabled or no longer registers the address', async () => {
    const states = [
      null,
      { enabled: false, redirectUris: [URI] },
      { enabled: true, redirectUris: ['https://app.example/else'] },
    ];
    for (const state of states) {
      const { tenantName, key } = await link('verify_email', { clientId: CLIENT, uri: URI });
      registration = state;
      const done = await press(tenantName, key);
      registration = { enabled: true, redirectUris: [URI] };
      expect(done.statusCode).toBe(200);
      expect(done.body).not.toContain('<a ');
    }
  });

  it('shows nothing of the client on a link that names none', async () => {
    for (const [type, password] of [
      ['verify_email', undefined],
      ['reset_password', NEW_PASSWORD],
      ['execute_actions', undefined],
    ] as const) {
      const { tenantName, key } = await link(type, undefined);
      const done = await press(tenantName, key, password);
      expect(done.statusCode).toBe(200);
      expect(done.body).not.toContain('<a ');
      expect(done.body).not.toContain('action_status');
    }
  });
});
