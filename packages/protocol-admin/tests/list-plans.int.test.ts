import { appendFileSync } from 'node:fs';
import {
  bypassesRowLevelSecurity,
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listClients, type ClientFilters } from '#/usecase/clients';
import { listSubjects, type SubjectFilters } from '#/usecase/subjects';
import { listTenants, type TenantFilters } from '#/usecase/tenants';

// Holds each searched listing to the plan docs/phases/p4d.md records: one
// Index Scan of the search column's index, with both bounds (and, past the
// first page, the keyset) in its Index Cond, and no Sort anywhere. Rows
// per table are enough that a sequential scan and a sort would be chosen
// if the range could not use the index. LIST_PLANS_OUT names a file to
// append each statement and its EXPLAIN (ANALYZE, BUFFERS) to.
const ROWS = 30_000;
const CURSOR_KEY = new Uint8Array(32).fill(1);
const PLANS_OUT = process.env.LIST_PLANS_OUT;

interface Statement {
  readonly query: string;
  readonly parameters: readonly unknown[];
}

interface PlanNode {
  readonly nodeType: string;
  readonly indexName: string | undefined;
  readonly indexCond: string | undefined;
  readonly filter: string | undefined;
  readonly children: readonly PlanNode[];
}

let container: TestDatabase | undefined;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let captured: Statement[] | undefined;
let targetTenantId: string;

function capture(query: string, parameters: readonly unknown[]): void {
  captured?.push({ query, parameters });
}

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl, { max: 2, onQuery: capture });
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 2, onQuery: capture });

  const tenantIds: string[] = [];
  for (const name of ['plan-target', 'plan-other-a', 'plan-other-b']) {
    const [row] = await owner.sql<{ id: string }[]>`
      insert into tenants (id, name) values (gen_random_uuid(), ${name}) returning id`;
    if (row === undefined) throw new Error('tenant insert returned no row');
    tenantIds.push(row.id);
  }
  const [target] = tenantIds;
  if (target === undefined) throw new Error('no target tenant');
  targetTenantId = target;

  await owner.sql`
    insert into tenants (id, name, display_name)
    select gen_random_uuid(),
           't' || substr(md5(g::text), 1, 8) || '-' || g,
           case when g % 3 = 0 then null
                when g % 2 = 0 then upper(substr(md5((g * 7)::text), 1, 6)) || ' Corp ' || g
                else substr(md5((g * 7)::text), 1, 6) || ' corp ' || g end
      from generate_series(1, ${ROWS}) g`;

  for (const tenantId of tenantIds) {
    await owner.sql`
      insert into subjects (id, tenant_id, type)
      select gen_random_uuid(), ${tenantId}, 'user' from generate_series(1, ${ROWS})`;
    await owner.sql`
      insert into users (subject_id, tenant_id, username, email)
      select s.id, s.tenant_id,
             case when n % 2 = 0 then upper(substr(md5(n::text), 1, 8))
                  else substr(md5(n::text), 1, 8) end || '-' || n,
             case when n % 3 = 0 then null
                  else substr(md5((n * 7)::text), 1, 8) || n || '@example.com' end
        from (select id, tenant_id, row_number() over () as n
                from subjects where tenant_id = ${tenantId}) s`;
    await owner.sql`
      insert into clients (id, tenant_id, client_id, name, type)
      select gen_random_uuid(), ${tenantId},
             case when g % 2 = 0 then upper(substr(md5(g::text), 1, 8))
                  else substr(md5(g::text), 1, 8) end || '-' || g,
             case when g % 2 = 0 then initcap(substr(md5((g * 3)::text), 1, 6))
                  else substr(md5((g * 3)::text), 1, 6) end || ' app ' || g,
             'public'
        from generate_series(1, ${ROWS}) g`;
    await owner.sql`
      insert into client_oidc_config
        (client_id, tenant_id, redirect_uris, grant_types, token_endpoint_auth_method)
      select id, tenant_id, '{https://app.example/cb}', '{authorization_code}', 'none'
        from clients where tenant_id = ${tenantId}`;
  }
  await owner.sql`analyze`;
}, 300_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container?.stop();
});

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function planNode(value: unknown): PlanNode {
  if (typeof value !== 'object' || value === null) throw new Error('plan node is not an object');
  const node = value as Record<string, unknown>;
  const nodeType = node['Node Type'];
  if (typeof nodeType !== 'string') throw new Error('plan node has no Node Type');
  const plans = node.Plans;
  return {
    nodeType,
    indexName: optionalString(node['Index Name']),
    indexCond: optionalString(node['Index Cond']),
    filter: optionalString(node.Filter),
    children: Array.isArray(plans) ? plans.map(planNode) : [],
  };
}

function allNodes(node: PlanNode): PlanNode[] {
  return [node, ...node.children.flatMap(allNodes)];
}

function rootPlan(explained: unknown): PlanNode {
  const document: unknown = typeof explained === 'string' ? JSON.parse(explained) : explained;
  if (!Array.isArray(document)) throw new Error('EXPLAIN (FORMAT JSON) returned no array');
  const first: unknown = document[0];
  if (typeof first !== 'object' || first === null || !('Plan' in first)) {
    throw new Error('EXPLAIN (FORMAT JSON) returned no Plan');
  }
  return planNode(first.Plan);
}

// The listing's own statement: the one that orders its page, not the
// lower() it asks first or the batched read of a page's client scopes.
async function issuedBy(run: () => Promise<string | null>): Promise<{
  readonly statement: Statement;
  readonly next: string | null;
}> {
  captured = [];
  const next = await run();
  const statements = captured;
  captured = undefined;
  const statement = statements.find((s) => /\border by\b/iu.test(s.query));
  if (statement === undefined) throw new Error('the listing issued no ordered select');
  return { statement, next };
}

async function explained(
  handle: DatabaseHandle,
  statement: Statement,
  options: string,
  tenantId: string | undefined,
): Promise<unknown[]> {
  const parameters = statement.parameters as Parameters<DatabaseHandle['sql']['unsafe']>[1];
  const rows = await handle.sql.begin(async (tx) => {
    if (tenantId !== undefined) await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
    return tx.unsafe<{ 'QUERY PLAN': unknown }[]>(
      `EXPLAIN (${options}) ${statement.query}`,
      parameters,
    );
  });
  return rows.map((row) => row['QUERY PLAN']);
}

interface PlanCase {
  readonly label: string;
  readonly index: string;
  readonly column: string;
  // The tenants collection is read through the owner connection, so that
  // is the connection its plan is taken on; the others run as the
  // application role, under row-level security.
  readonly throughOwner: boolean;
  readonly list: (cursor: string | undefined) => Promise<string | null>;
}

function subjectsCase(label: string, index: string, column: string, filters: SubjectFilters) {
  return {
    label,
    index,
    column,
    throughOwner: false,
    list: async (cursor: string | undefined) => {
      const outcome = await withTenant(app.db, targetTenantId, (tx) =>
        listSubjects(tx, {
          limit: 50,
          cursor,
          cursorKey: CURSOR_KEY,
          tenantId: targetTenantId,
          filters,
        }),
      );
      return outcome.kind === 'ok' ? outcome.next : null;
    },
  };
}

function clientsCase(label: string, index: string, column: string, filters: ClientFilters) {
  return {
    label,
    index,
    column,
    throughOwner: false,
    list: async (cursor: string | undefined) => {
      const outcome = await withTenant(app.db, targetTenantId, (tx) =>
        listClients(tx, {
          limit: 50,
          cursor,
          cursorKey: CURSOR_KEY,
          tenantId: targetTenantId,
          filters,
        }),
      );
      return outcome.kind === 'ok' ? outcome.next : null;
    },
  };
}

function tenantsCase(label: string, index: string, column: string, filters: TenantFilters) {
  return {
    label,
    index,
    column,
    throughOwner: true,
    list: async (cursor: string | undefined) => {
      const outcome = await listTenants(owner.db, {
        limit: 50,
        cursor,
        cursorKey: CURSOR_KEY,
        tenantId: targetTenantId,
        filters,
      });
      return outcome.kind === 'ok' ? outcome.next : null;
    },
  };
}

const CASES: readonly PlanCase[] = [
  subjectsCase('subjects ?username=A', 'users_username_search', 'username_search', {
    username: 'A',
  }),
  subjectsCase('subjects ?email=a', 'users_email_search', 'email_search', { email: 'a' }),
  tenantsCase('tenants ?name=T3', 'tenants_name_search', 'name_search', { name: 'T3' }),
  tenantsCase('tenants ?display_name=A', 'tenants_display_name_search', 'display_name_search', {
    display_name: 'A',
  }),
  clientsCase('clients ?client_id=B', 'clients_client_id_search', 'client_id_search', {
    client_id: 'B',
  }),
  clientsCase('clients ?name=C', 'clients_name_search', 'name_search', { name: 'C' }),
];

describe('the plan each searched listing is given', () => {
  it('explains the application-role cases as a role row-level security binds', async () => {
    expect(await bypassesRowLevelSecurity(app)).toBe(false);
  });

  describe.each(CASES)('$label', (planCase) => {
    it.each([
      ['the first page', false],
      ['a later page', true],
    ])('is one range scan of its index, with no sort, on %s', async (page, later) => {
      let cursor: string | undefined;
      if (later) {
        const first = await planCase.list(undefined);
        if (first === null) throw new Error(`${planCase.label} fitted on one page`);
        cursor = first;
      }
      const { statement } = await issuedBy(() => planCase.list(cursor));
      const handle = planCase.throughOwner ? owner : app;
      const tenantId = planCase.throughOwner ? undefined : targetTenantId;

      const [json] = await explained(handle, statement, 'FORMAT JSON', tenantId);
      const nodes = allNodes(rootPlan(json));
      const scan = nodes.find((node) => node.indexName === planCase.index);

      expect(scan?.nodeType).toBe('Index Scan');
      expect(scan?.indexCond).toContain(`${planCase.column} >=`);
      expect(scan?.indexCond).toContain(`${planCase.column} <`);
      if (later) expect(scan?.indexCond).toContain(`ROW(${planCase.column}`);
      expect(scan?.filter ?? '').not.toContain(planCase.column);
      expect(nodes.map((node) => node.nodeType)).not.toContain('Sort');
      expect(nodes.map((node) => node.nodeType)).not.toContain('Incremental Sort');

      if (PLANS_OUT !== undefined) {
        const text = await explained(handle, statement, 'ANALYZE, BUFFERS', tenantId);
        appendFileSync(
          PLANS_OUT,
          [
            `### ${planCase.label}, ${page}`,
            statement.query,
            `params: ${JSON.stringify(statement.parameters)}`,
            ...text.map(String),
            '',
          ].join('\n'),
        );
      }
    });
  });
});
