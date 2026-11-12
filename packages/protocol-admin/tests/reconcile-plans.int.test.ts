import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { userRepository } from '@odudu/domain-identity';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountReconcileRepository } from '#/repository/account-reconcile';

// Rows enough that a sequential scan and a sort would win if the address
// could not be walked in index order, in a tenant among others.
const ROWS = 30_000;
const PAIRS = 200;

interface Statement {
  readonly query: string;
  readonly parameters: readonly unknown[];
}

interface Node {
  readonly type: string;
  readonly index: string | undefined;
  readonly relation: string | undefined;
  readonly children: readonly Node[];
}

let container: TestDatabase | undefined;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let captured: Statement[] | undefined;
let tenantId: string;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl, { max: 2 });
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), {
    max: 2,
    onQueryForTests: (query, parameters) => captured?.push({ query, parameters }),
  });
  tenantId = randomUUID();
  const others = [randomUUID(), randomUUID()];
  for (const id of [tenantId, ...others]) {
    await owner.sql`insert into tenants (id, name) values (${id}, ${'plan-' + id.slice(0, 8)})`;
    await owner.sql`
      insert into subjects (id, tenant_id, type)
      select gen_random_uuid(), ${id}, 'user' from generate_series(1, ${ROWS})`;
    await owner.sql`
      insert into users (subject_id, tenant_id, username, email)
      select s.id, s.tenant_id, 'u' || n,
             case when n between 2 and ${PAIRS} * 2 + 1 then
                    case when n % 2 = 0 then 'dup' || (n / 2) || '@example.com'
                         else 'DUP' || (n / 2) || '@Example.com' end
                  else substr(md5(n::text), 1, 12) || n || '@example.com' end
        from (select id, tenant_id, row_number() over () as n
                from subjects where tenant_id = ${id}) s`;
  }
  await owner.sql`
    insert into audit_events
      (id, tenant_id, event_type, action, outcome, actor_subject_id, resource_type, resource_id)
    select gen_random_uuid(), tenant_id, 'admin_mutation', 'client.create', 'allowed',
           subject_id, 'client', 'x'
      from users where username not like 'u1%'`;
  await owner.sql`analyze users`;
  await owner.sql`analyze audit_events`;
}, 300_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container?.stop();
});

function node(value: unknown): Node {
  if (typeof value !== 'object' || value === null) throw new Error('plan node is not an object');
  const raw = value as Record<string, unknown>;
  const plans = raw.Plans;
  const index = raw['Index Name'];
  const relation = raw['Relation Name'];
  return {
    type: String(raw['Node Type']),
    index: typeof index === 'string' ? index : undefined,
    relation: typeof relation === 'string' ? relation : undefined,
    children: Array.isArray(plans) ? plans.map(node) : [],
  };
}

function flatten(root: Node): Node[] {
  return [root, ...root.children.flatMap(flatten)];
}

async function planOf(run: () => Promise<unknown>): Promise<Node[]> {
  captured = [];
  await run();
  const statements = captured;
  captured = undefined;
  const statement = statements.find((s) => /\bfrom "?users"?(?![\w])/iu.test(s.query));
  if (statement === undefined) throw new Error('the call issued no read of users');
  const rows = await app.sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
    return tx.unsafe<{ 'QUERY PLAN': unknown }[]>(
      `EXPLAIN (FORMAT JSON) ${statement.query}`,
      statement.parameters as Parameters<DatabaseHandle['sql']['unsafe']>[1],
    );
  });
  const document = rows[0]?.['QUERY PLAN'];
  const parsed: unknown = typeof document === 'string' ? JSON.parse(document) : document;
  const first: unknown = Array.isArray(parsed) ? parsed[0] : undefined;
  if (typeof first !== 'object' || first === null || !('Plan' in first)) {
    throw new Error('EXPLAIN returned no Plan');
  }
  return flatten(node(first.Plan));
}

describe('the plans of the reconcile command', () => {
  it('walks the duplicate addresses in index order, from the start and past a cursor', async () => {
    for (const after of [null, 'dup50@example.com']) {
      const plan = await planOf(() =>
        withTenant(app.db, tenantId, (tx) =>
          accountReconcileRepository(tx, tenantId).duplicateAddresses(after, 100),
        ),
      );
      const scan = plan.find((n) => n.relation === 'users');
      expect(scan?.index, `after ${String(after)}`).toBe('users_email_search');
      expect(plan.map((n) => n.type).join(' ')).not.toMatch(/Sort|Seq Scan|Hash/u);
    }
  });

  it('finds the addresses it is asked for, a page at a time', async () => {
    const pages: string[][] = [];
    await withTenant(app.db, tenantId, async (tx) => {
      const repository = accountReconcileRepository(tx, tenantId);
      let after: string | null = null;
      for (;;) {
        const page: string[] = await repository.duplicateAddresses(after, 80);
        pages.push(page);
        if (page.length < 80) return;
        after = page.at(-1) ?? null;
      }
    });
    expect(pages.flat()).toHaveLength(PAIRS);
    expect(new Set(pages.flat()).size).toBe(pages.flat().length);
    expect(pages.every((page) => page.length <= 80)).toBe(true);
  });

  it('reads the accounts of one address by index', async () => {
    const plan = await planOf(() =>
      withTenant(app.db, tenantId, (tx) =>
        accountReconcileRepository(tx, tenantId).lockAccounts('dup7@example.com'),
      ),
    );
    const scan = plan.find((n) => n.relation === 'users');
    expect(scan?.index).toBe('users_email_search');
    expect(plan.map((n) => n.type)).not.toContain('Seq Scan');
  });

  it('probes the audit trail for a sign-in through the actor index, never a scan', async () => {
    const plan = await planOf(() =>
      withTenant(app.db, tenantId, (tx) =>
        accountReconcileRepository(tx, tenantId).lockAccounts('dup7@example.com'),
      ),
    );
    const audit = plan.filter((n) => n.relation === 'audit_events');
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.every((n) => n.index === 'audit_events_actor')).toBe(true);
    expect(plan.map((n) => n.type)).not.toContain('Seq Scan');
  });

  it('serves a lookup by tenant and address by an index', async () => {
    const plan = await planOf(() =>
      withTenant(app.db, tenantId, (tx) => userRepository(tx).holderOfEmail('DUP7@example.com')),
    );
    expect(plan.find((n) => n.relation === 'users')?.index).toBe('users_email_search');
    expect(plan.map((n) => n.type)).not.toContain('Seq Scan');
  });
});
