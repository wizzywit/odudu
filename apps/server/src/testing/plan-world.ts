import { loadConfig, newId } from '@odudu/kernel';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  type DatabaseHandle,
  type DatabaseOptions,
} from '@odudu/db';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { type FastifyInstance } from 'fastify';
import { buildApp } from '#/app';
import { seed, seedAdmin } from '#/cli/seed';
import { createLogger } from '#/logger';
import { seedPlanVolume } from '#/testing/plan-volume';

export const KEK = Buffer.alloc(32, 7);
export const TARGET_TENANT = 'plans';
export const TARGET_CLIENT = 'plans-app';
export const TARGET_SECRET = 'a-client-secret-for-the-plan-check';
export const TARGET_USER = 'alice';
export const TARGET_PASSWORD = 'correct horse battery staple';
export const REDIRECT_URI = 'https://app.example/cb';
export const PUBLIC_BASE_URL = 'http://localhost';

export interface PlanWorld {
  readonly container: TestDatabase;
  readonly owner: DatabaseHandle;
  readonly app: DatabaseHandle;
  readonly http: FastifyInstance;
  readonly tenantId: string;
  readonly clientDbId: string;
  readonly volumeSeconds: number;
  stop(): Promise<void>;
}

// What each of the server's two connections is created with: the test
// passes the statement hook, which production code may never name.
export interface WorldConnections {
  readonly owner: DatabaseOptions;
  readonly app: DatabaseOptions;
}

// The settings the plans are judged under, fixed so a run's plans depend on the
// data and the code: no background analyze replacing the statistics mid-run, no
// parallel workers, and the page cost of the SSD a deployment runs on.
async function pinPlanner(owner: DatabaseHandle): Promise<void> {
  await owner.sql.unsafe('alter system set autovacuum = off');
  await owner.sql.unsafe('alter system set max_parallel_workers_per_gather = 0');
  await owner.sql.unsafe('alter system set random_page_cost = 1.1');
  await owner.sql.unsafe('select pg_reload_conf()');
}

// One tenant provisioned the way an operator does, scaled up in SQL, beside
// thousands of small ones, and the real composition root over both
// connections the server uses.
export async function startPlanWorld(connections: WorldConnections): Promise<PlanWorld> {
  const container = await startTestDatabase();
  const owner = createDatabase(container.adminUrl, { max: 3, ...connections.owner });
  await runMigrations(owner.db, MIGRATIONS_DIR);
  await pinPlanner(owner);
  const appUrl = await createAppRole(container.adminUrl);
  const app = createDatabase(appUrl, { max: 5, ...connections.app });

  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  process.env.ODUDU_PUBLIC_BASE_URL = PUBLIC_BASE_URL;

  const seeded = await seed({
    tenant: TARGET_TENANT,
    clientId: TARGET_CLIENT,
    clientSecret: TARGET_SECRET,
    tokenEndpointAuthMethod: 'client_secret_basic',
    redirectUris: [REDIRECT_URI],
    username: TARGET_USER,
    password: TARGET_PASSWORD,
    email: 'alice@example.test',
  });
  const [client] = await owner.sql<{ id: string }[]>`
    select id from clients where tenant_id = ${seeded.tenantId} and client_id = ${TARGET_CLIENT}`;
  if (client === undefined) throw new Error('the seeded client is missing');

  const started = Date.now();
  await seedPlanVolume(owner, { tenantId: seeded.tenantId, clientDbId: client.id });
  const volumeSeconds = (Date.now() - started) / 1000;

  const [system] = await owner.sql<{ id: string }[]>`select id from tenants where name = 'system'`;
  if (system === undefined) await seedAdmin({ username: 'plan-admin' });

  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' });
  const http = buildApp({
    database: app,
    ownerDatabase: owner,
    kek: KEK,
    logger: createLogger(config),
    publicBaseUrl: PUBLIC_BASE_URL,
    consoleBaseUrl: PUBLIC_BASE_URL,
    throttle: { limit: 1_000_000, windowSeconds: 60 },
    clientSecretThrottle: { limit: 1_000_000, windowSeconds: 60 },
  });
  await http.ready();

  return {
    container,
    owner,
    app,
    http,
    tenantId: seeded.tenantId,
    clientDbId: client.id,
    volumeSeconds,
    stop: async () => {
      await http.close();
      await app.close();
      await owner.close();
      await container.stop();
      for (const name of [
        'ODUDU_DATABASE_URL',
        'ODUDU_APP_DATABASE_URL',
        'ODUDU_KEK',
        'ODUDU_PUBLIC_BASE_URL',
      ]) {
        Reflect.deleteProperty(process.env, name);
      }
    },
  };
}

export function uniqueName(prefix: string): string {
  return `${prefix}-${newId()}`;
}
