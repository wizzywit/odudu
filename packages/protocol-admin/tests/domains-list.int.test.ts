import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { coerceLimit } from '#/service/cursor';
import { MAX_LIMIT } from '@odudu/contracts/admin';
import { listDomains } from '#/usecase/domains';

const ROWS = 10_000;
const CURSOR_KEY = new Uint8Array(32).fill(3);

let container: TestDatabase | undefined;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let statements: string[] = [];
let tenantId = '';

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl, { max: 2 });
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), {
    max: 2,
    onQueryForTests: (query) => {
      statements.push(query);
    },
  });
  const [row] = await owner.sql<{ id: string }[]>`
    insert into tenants (id, name) values (gen_random_uuid(), 'bulk') returning id`;
  tenantId = row?.id ?? '';
  await owner.sql`
    insert into tenant_domains (id, tenant_id, host, challenge)
    select gen_random_uuid(), ${tenantId}, 'h' || g || '.bulk-corp.org', 'c'
      from generate_series(1, ${ROWS}) g`;
}, 180_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container?.stop();
});

describe('a tenant with 10,000 domains', () => {
  it('pages under MAX_LIMIT, each page a constant number of reads of the table', async () => {
    const limit = coerceLimit(String(ROWS));
    expect(limit).toBe(MAX_LIMIT);
    let cursor: string | undefined;
    let seen = 0;
    const perPage: number[] = [];
    const hosts = new Set<string>();
    for (let page = 0; page < 100; page += 1) {
      statements = [];
      const outcome = await withTenant(app.db, tenantId, (tx) =>
        listDomains(tx, { limit, cursor, cursorKey: CURSOR_KEY, tenantId }),
      );
      if (outcome.kind !== 'ok') throw new Error('the cursor was refused');
      expect(outcome.items.length).toBeLessThanOrEqual(MAX_LIMIT);
      for (const item of outcome.items) hosts.add(item.host);
      seen += outcome.items.length;
      perPage.push(statements.filter((query) => query.includes('"tenant_domains"')).length);
      if (outcome.next === null) break;
      cursor = outcome.next;
    }
    expect(seen).toBe(ROWS);
    expect(hosts.size).toBe(ROWS);
    expect(new Set(perPage)).toEqual(new Set([2]));
  });
});
