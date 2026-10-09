import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import {
  bypassesRowLevelSecurity,
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAudit } from '#/usecase/audit';
import { listClients, type ClientFilters } from '#/usecase/clients';
import {
  COUNT_CAP,
  countClients,
  countGroups,
  countRoles,
  countScopes,
  countSubjects,
  countTenants,
  type CountOptions,
} from '#/usecase/counts';
import { listGroups } from '#/usecase/groups';
import { listLogoutDeliveries } from '#/usecase/logout-deliveries';
import { listMail } from '#/usecase/mail';
import { listRoles, type RoleFilters } from '#/usecase/roles';
import { listScopes } from '#/usecase/scopes';
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
const SCOPED_CLIENTS = 100;
const ROLES_PER_CLIENT = 300;
// A grant that has been refreshed thousands of times: refresh rotation,
// token issuance and revocation each write a 'grant' row against the same
// resource_id, so a busy grant's own trail is not the handful of rows a
// resource ordinarily has.
const BUSY_RESOURCE_ROWS = 5_000;
const HELD_ROLE_SUBJECTS = 2_000;
const SERVICE_SUBJECTS = 50;
const CHILD_GROUPS = 3_000;

interface Statement {
  readonly query: string;
  readonly parameters: readonly unknown[];
}

interface PlanNode {
  readonly nodeType: string;
  readonly relationName: string | undefined;
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
let scopedClientId: string;
let busyGrantId: string;
let heldRoleId: string;
let parentGroupId: string;

function capture(query: string, parameters: readonly unknown[]): void {
  captured?.push({ query, parameters });
}

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl, { max: 2, onQueryForTests: capture });
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), {
    max: 2,
    onQueryForTests: capture,
  });

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
      insert into users (subject_id, tenant_id, username, email, name, given_name, family_name)
      select s.id, s.tenant_id,
             case when n % 2 = 0 then upper(substr(md5(n::text), 1, 8))
                  else substr(md5(n::text), 1, 8) end || '-' || n,
             case when n % 3 = 0 then null
                  else substr(md5((n * 7)::text), 1, 8) || n || '@example.com' end,
             case when n % 4 = 0 then null
                  else initcap(substr(md5((n * 11)::text), 1, 6)) || ' ' || n end,
             case when n % 4 = 0 then null else initcap(substr(md5((n * 11)::text), 1, 6)) end,
             case when n % 5 = 0 then null else substr(md5((n * 13)::text), 1, 7) end
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
    for (const table of ['roles', 'client_scopes']) {
      await owner.sql`
        insert into ${owner.sql(table)} (id, tenant_id, name)
        select gen_random_uuid(), ${tenantId},
               case when g % 2 = 0 then upper(substr(md5((g * 5)::text), 1, 8))
                    else substr(md5((g * 5)::text), 1, 8) end || '-' || g
          from generate_series(1, ${ROWS}) g`;
    }
    await owner.sql`
      insert into roles (id, tenant_id, client_id, name)
      select gen_random_uuid(), ${tenantId}, c.id,
             case when g % 2 = 0 then upper(substr(md5((c.n * 1000 + g)::text), 1, 8))
                  else substr(md5((c.n * 1000 + g)::text), 1, 8) end || '-' || g
        from (select id, row_number() over (order by id) as n
                from clients where tenant_id = ${tenantId} order by id limit ${SCOPED_CLIENTS}) c
       cross join generate_series(1, ${ROLES_PER_CLIENT}) g`;
    await owner.sql`
      insert into groups (id, tenant_id, name, path)
      select gen_random_uuid(), ${tenantId}, name, '/' || name
        from (select case when g % 2 = 0 then upper(substr(md5((g * 11)::text), 1, 8))
                          else substr(md5((g * 11)::text), 1, 8) end || '-' || g as name
                from generate_series(1, ${ROWS}) g) named`;
    // One audit row per client, resource_id the client's own id: enough
    // rows that a per-resource read has something to be bounded against,
    // and exactly one match for the resource_type+resource_id case below.
    await owner.sql`
      insert into audit_events
        (id, tenant_id, occurred_at, event_type, action, outcome, resource_type, resource_id)
      select gen_random_uuid(), tenant_id, now() - (n || ' seconds')::interval,
             'admin_mutation', 'client.create', 'allowed', 'client', id::text
        from (select id, tenant_id, row_number() over () as n
                from clients where tenant_id = ${tenantId}) c`;
  }
  const [scoped] = await owner.sql<{ id: string }[]>`
    select id from clients where tenant_id = ${targetTenantId} order by id limit 1`;
  if (scoped === undefined) throw new Error('no client in the target tenant');
  scopedClientId = scoped.id;

  // A few service subjects among many users, one group with many children,
  // and an outbox and a delivery queue long enough to page.
  await owner.sql`
    insert into subjects (id, tenant_id, type)
    select gen_random_uuid(), ${targetTenantId}, 'service' from generate_series(1, ${SERVICE_SUBJECTS})`;
  const [parent] = await owner.sql<{ id: string; path: string }[]>`
    select id, path from groups where tenant_id = ${targetTenantId} order by id limit 1`;
  if (parent === undefined) throw new Error('no group in the target tenant');
  parentGroupId = parent.id;
  await owner.sql`
    insert into groups (id, tenant_id, parent_id, name, path)
    select gen_random_uuid(), ${targetTenantId}, ${parent.id}, 'child-' || g,
           ${parent.path} || '/child-' || g
      from generate_series(1, ${CHILD_GROUPS}) g`;
  await owner.sql`
    insert into email_outbox (id, tenant_id, to_address, subject, body_text, body_html, created_at)
    select gen_random_uuid(), ${targetTenantId}, 'user' || g || '@example.com', 'Verify', 'x', 'x',
           now() - (g || ' seconds')::interval
      from generate_series(1, ${ROWS}) g`;
  await owner.sql`
    insert into backchannel_logout_deliveries
      (id, tenant_id, client_id, session_id, endpoint, logout_token, created_at)
    select gen_random_uuid(), ${targetTenantId}, c.id, gen_random_uuid(),
           'https://rp.example/bcl', 'token', now() - (g || ' seconds')::interval
      from (select id from clients where tenant_id = ${targetTenantId} order by id limit 20) c
     cross join generate_series(1, ${ROWS / 20}) g`;

  const [held] = await owner.sql<{ id: string }[]>`
    select id from roles
     where tenant_id = ${targetTenantId} and client_id is null order by id limit 1`;
  if (held === undefined) throw new Error('no tenant role in the target tenant');
  heldRoleId = held.id;
  await owner.sql`
    insert into subject_roles (tenant_id, subject_id, role_id)
    select tenant_id, id, ${heldRoleId}
      from subjects where tenant_id = ${targetTenantId} order by id limit ${HELD_ROLE_SUBJECTS}`;

  busyGrantId = randomUUID();
  await owner.sql`
    insert into audit_events
      (id, tenant_id, occurred_at, event_type, action, outcome, resource_type, resource_id)
    select gen_random_uuid(), ${targetTenantId}, now() - (n || ' seconds')::interval,
           'token', 'token.refresh', 'allowed', 'grant', ${busyGrantId}
      from generate_series(1, ${BUSY_RESOURCE_ROWS}) n`;

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
    relationName: optionalString(node['Relation Name']),
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
          now: new Date(),
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

function namedCase(
  label: string,
  index: string,
  list: (tx: TenantScopedDatabase, cursor: string | undefined) => Promise<string | null>,
) {
  return {
    label,
    index,
    column: 'name_search',
    throughOwner: false,
    list: (cursor: string | undefined) =>
      withTenant(app.db, targetTenantId, (tx) => list(tx, cursor)),
  };
}

function pageOf(cursor: string | undefined, filters: RoleFilters) {
  return { limit: 50, cursor, cursorKey: CURSOR_KEY, tenantId: targetTenantId, filters };
}

function nextOf(outcome: { readonly kind: string; readonly next?: string | null }): string | null {
  return outcome.kind === 'ok' ? (outcome.next ?? null) : null;
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
  subjectsCase('subjects ?name=b', 'users_name_search', 'name_search', { name: 'b' }),
  subjectsCase('subjects ?given_name=c', 'users_given_name_search', 'given_name_search', {
    given_name: 'c',
  }),
  subjectsCase('subjects ?family_name=d', 'users_family_name_search', 'family_name_search', {
    family_name: 'd',
  }),
  tenantsCase('tenants ?name=T3', 'tenants_name_search', 'name_search', { name: 'T3' }),
  tenantsCase('tenants ?display_name=A', 'tenants_display_name_search', 'display_name_search', {
    display_name: 'A',
  }),
  clientsCase('clients ?client_id=B', 'clients_client_id_search', 'client_id_search', {
    client_id: 'B',
  }),
  clientsCase('clients ?name=C', 'clients_name_search', 'name_search', { name: 'C' }),
  namedCase('roles ?name=A', 'roles_name_search', async (tx, cursor) =>
    nextOf(await listRoles(tx, pageOf(cursor, { name: 'A' }))),
  ),
  namedCase('groups ?name=B', 'groups_name_search', async (tx, cursor) =>
    nextOf(await listGroups(tx, pageOf(cursor, { name: 'B' }))),
  ),
  namedCase('scopes ?name=c', 'client_scopes_name_search', async (tx, cursor) =>
    nextOf(await listScopes(tx, pageOf(cursor, { name: 'c' }))),
  ),
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

      // The keyed read of a two-step listing never touches the heap.
      expect(['Index Scan', 'Index Only Scan']).toContain(scan?.nodeType);
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

// A search narrowed by ?client= is not held to one shape the way a bare
// search is. Under `client=tenant` no index orders the tenant roles by
// name_search, so the owner test is a Filter on the search index scan.
// Under `client=<id>` the planner may instead intersect
// `roles_client_name` with the search index and sort what is left, which
// is bounded by that one client's roles.
function combinedRolesCase(client: 'tenant' | 'scoped') {
  const filters = (): RoleFilters => ({
    name: 'A',
    client: client === 'tenant' ? 'tenant' : scopedClientId,
  });
  return (cursor: string | undefined) =>
    withTenant(app.db, targetTenantId, async (tx) =>
      nextOf(await listRoles(tx, pageOf(cursor, filters()))),
    );
}

async function recordPlan(label: string, statement: Statement): Promise<void> {
  if (PLANS_OUT === undefined) return;
  const text = await explained(app, statement, 'ANALYZE, BUFFERS', targetTenantId);
  appendFileSync(
    PLANS_OUT,
    [
      `### ${label}`,
      statement.query,
      `params: ${JSON.stringify(statement.parameters)}`,
      ...text.map(String),
      '',
    ].join('\n'),
  );
}

describe('the plan a roles search narrowed by ?client= is given', () => {
  it.each([
    ['the first page', false],
    ['a later page', true],
  ])(
    'under client=tenant, is the search index scan with the owner test as a Filter, on %s',
    async (page, later) => {
      const list = combinedRolesCase('tenant');
      const first = await list(undefined);
      if (later && first === null) throw new Error('client=tenant fitted on one page');
      const cursor = later && first !== null ? first : undefined;
      const { statement } = await issuedBy(() => list(cursor));

      const [json] = await explained(app, statement, 'FORMAT JSON', targetTenantId);
      const nodes = allNodes(rootPlan(json));
      const scan = nodes.find((node) => node.indexName === 'roles_name_search');
      expect(scan?.nodeType).toBe('Index Scan');
      expect(scan?.indexCond).toContain('name_search >=');
      expect(scan?.indexCond).toContain('name_search <');
      if (later) expect(scan?.indexCond).toContain('ROW(name_search');
      expect(scan?.filter).toContain('client_id IS NULL');
      expect(nodes.map((node) => node.nodeType)).not.toContain('Sort');
      await recordPlan(`roles ?name=A&client=tenant, ${page}`, statement);
    },
  );

  it('under client=<id>, reads only that client’s roles, and never the whole table', async () => {
    const list = combinedRolesCase('scoped');
    await list(undefined);
    const { statement } = await issuedBy(() => list(undefined));

    const [json] = await explained(app, statement, 'FORMAT JSON', targetTenantId);
    const nodes = allNodes(rootPlan(json));
    expect(nodes.map((node) => node.nodeType)).not.toContain('Seq Scan');
    expect(nodes.some((node) => node.indexCond?.includes('client_id =') === true)).toBe(true);
    await recordPlan('roles ?name=A&client=<id>, the first page', statement);
  });
});

// `audit_events_resource` (0076) orders on (tenant_id, resource_type,
// resource_id, occurred_at DESC, id DESC) — the listing's own order — so a
// per-resource read stops at LIMIT through the index alone, sort-free even
// against a resource whose own trail runs to thousands of rows (a busy
// grant's, across refresh rotation, token issuance and revocation). 0067's
// predecessor index ordered on the first three columns only, which left
// this to a Sort; see docs/phases/p4d.md for the measured difference.
describe('the plan an audit trail narrowed by resource_type and resource_id is given', () => {
  it('reads through the resource index, never the whole table', async () => {
    const list = (cursor: string | undefined) =>
      withTenant(app.db, targetTenantId, async (tx) => {
        const outcome = await listAudit(tx, {
          revealNames: true,
          tenantId: targetTenantId,
          limit: 50,
          cursor,
          cursorKey: CURSOR_KEY,
          resourceType: 'client',
          resourceId: scopedClientId,
        });
        return outcome.kind === 'ok' ? outcome.next : null;
      });
    await list(undefined);
    const { statement } = await issuedBy(() => list(undefined));

    const [json] = await explained(app, statement, 'FORMAT JSON', targetTenantId);
    const nodes = allNodes(rootPlan(json));
    expect(nodes.map((node) => node.nodeType)).not.toContain('Seq Scan');
    const scan = nodes.find((node) => node.indexName === 'audit_events_resource');
    expect(scan).toBeDefined();
    expect(scan?.indexCond).toContain('resource_id =');
    await recordPlan('audit ?resource_type=client&resource_id=<id>, the first page', statement);
  });

  it.each([
    ['the first page', false],
    ['a later page', true],
  ])('is a sort-free index scan bounded by a busy resource, on %s', async (page, later) => {
    const list = (cursor: string | undefined) =>
      withTenant(app.db, targetTenantId, async (tx) => {
        const outcome = await listAudit(tx, {
          revealNames: true,
          tenantId: targetTenantId,
          limit: 50,
          cursor,
          cursorKey: CURSOR_KEY,
          resourceType: 'grant',
          resourceId: busyGrantId,
        });
        return outcome.kind === 'ok' ? outcome.next : null;
      });
    // Primes postgres.js's statement cache for this exact query shape: run
    // uncaptured once first, or `issuedBy`'s /order by/ search can instead
    // pick up the driver's own one-time pg_type introspection query, which
    // also happens to contain those words, ahead of the real select.
    const primed = await list(undefined);
    if (later && primed === null) throw new Error('the busy grant fitted on one page');
    const cursor = later ? (primed ?? undefined) : undefined;
    const { statement } = await issuedBy(() => list(cursor));

    const [json] = await explained(app, statement, 'FORMAT JSON', targetTenantId);
    const nodes = allNodes(rootPlan(json));
    const scan = nodes.find((node) => node.indexName === 'audit_events_resource');
    expect(scan?.nodeType).toBe('Index Scan');
    expect(scan?.indexCond).toContain("resource_type = 'grant'");
    expect(scan?.indexCond).toContain('resource_id =');
    if (later) expect(scan?.indexCond).toContain('ROW(occurred_at');
    expect(nodes.map((node) => node.nodeType)).not.toContain('Sort');
    expect(nodes.map((node) => node.nodeType)).not.toContain('Incremental Sort');

    if (PLANS_OUT !== undefined) {
      const text = await explained(app, statement, 'ANALYZE, BUFFERS', targetTenantId);
      appendFileSync(
        PLANS_OUT,
        [
          `### audit ?resource_type=grant&resource_id=<busy>, ${page}`,
          statement.query,
          `params: ${JSON.stringify(statement.parameters)}`,
          ...text.map(String),
          '',
        ].join('\n'),
      );
    }
  });
});

interface CountPlanCase {
  readonly label: string;
  readonly table: string;
  readonly index: string;
  readonly column: string;
  readonly throughOwner: boolean;
  // Set where a count may Seq Scan nothing, under any ceiling.
  readonly noSeqScan?: boolean;
  readonly count: (options: CountOptions) => Promise<unknown>;
}

function scopedCount(count: (tx: TenantScopedDatabase, options: CountOptions) => Promise<unknown>) {
  return (options: CountOptions) => withTenant(app.db, targetTenantId, (tx) => count(tx, options));
}

const COUNT_CASES: readonly CountPlanCase[] = [
  {
    label: 'subjects/count ?username=A',
    table: 'users',
    index: 'users_username_search',
    column: 'username_search',
    throughOwner: false,
    count: scopedCount((tx, options) => countSubjects(tx, { username: 'A' }, new Date(), options)),
  },
  {
    label: 'subjects/count ?email=a',
    table: 'users',
    index: 'users_email_search',
    column: 'email_search',
    throughOwner: false,
    count: scopedCount((tx, options) => countSubjects(tx, { email: 'a' }, new Date(), options)),
  },
  {
    label: 'subjects/count ?name=b',
    table: 'users',
    index: 'users_name_search',
    column: 'name_search',
    throughOwner: false,
    count: scopedCount((tx, options) => countSubjects(tx, { name: 'b' }, new Date(), options)),
  },
  {
    label: 'subjects/count ?given_name=c',
    table: 'users',
    index: 'users_given_name_search',
    column: 'given_name_search',
    throughOwner: false,
    count: scopedCount((tx, options) =>
      countSubjects(tx, { given_name: 'c' }, new Date(), options),
    ),
  },
  {
    label: 'subjects/count ?family_name=d',
    table: 'users',
    index: 'users_family_name_search',
    column: 'family_name_search',
    throughOwner: false,
    count: scopedCount((tx, options) =>
      countSubjects(tx, { family_name: 'd' }, new Date(), options),
    ),
  },
  {
    label: 'tenants/count ?name=T3',
    table: 'tenants',
    index: 'tenants_name_search',
    column: 'name_search',
    throughOwner: true,
    count: (options) => countTenants(owner.db, { name: 'T3' }, options),
  },
  {
    label: 'clients/count ?client_id=B',
    table: 'clients',
    index: 'clients_client_id_search',
    column: 'client_id_search',
    throughOwner: false,
    noSeqScan: true,
    count: scopedCount((tx, options) => countClients(tx, { client_id: 'B' }, options)),
  },
  {
    label: 'roles/count ?name=A',
    table: 'roles',
    index: 'roles_name_search',
    column: 'name_search',
    throughOwner: false,
    count: scopedCount((tx, options) => countRoles(tx, { name: 'A' }, options)),
  },
  {
    label: 'groups/count ?name=B',
    table: 'groups',
    index: 'groups_name_search',
    column: 'name_search',
    throughOwner: false,
    count: scopedCount((tx, options) => countGroups(tx, { name: 'B' }, options)),
  },
  {
    label: 'scopes/count ?name=c',
    table: 'client_scopes',
    index: 'client_scopes_name_search',
    column: 'name_search',
    throughOwner: false,
    count: scopedCount((tx, options) => countScopes(tx, { name: 'c' }, options)),
  },
];

// Each prefix matches a few hundred to a few thousand rows here. Under a
// ceiling inside the range the read stops at the ceiling: an ordered scan
// of the search index beneath the LIMIT, any join probing per row, no
// sort. Under COUNT_CAP the whole range is read and sorted, which the
// planner may do as a bitmap scan. A searched subjects count may then read
// the tenant's `subjects` rows through their index to hash-join them, when
// it costs that below probing per match (docs/phases/p4d.md).
async function countPlan(
  countCase: {
    readonly label: string;
    readonly throughOwner: boolean;
    readonly count: (options: CountOptions) => Promise<unknown>;
  },
  cap: number,
  regime: string,
): Promise<PlanNode[]> {
  await countCase.count({ cap });
  captured = [];
  await countCase.count({ cap });
  const statements = captured;
  captured = undefined;
  const statement = statements.find((s) => /\bcount\(/iu.test(s.query));
  if (statement === undefined) throw new Error(`${countCase.label} issued no count`);
  const handle = countCase.throughOwner ? owner : app;
  const tenantId = countCase.throughOwner ? undefined : targetTenantId;

  const [json] = await explained(handle, statement, 'FORMAT JSON', tenantId);
  if (PLANS_OUT !== undefined) {
    const text = await explained(handle, statement, 'ANALYZE, BUFFERS', tenantId);
    appendFileSync(
      PLANS_OUT,
      [
        `### ${countCase.label}, ${regime}`,
        statement.query,
        `params: ${JSON.stringify(statement.parameters)}`,
        ...text.map(String),
        '',
      ].join('\n'),
    );
  }
  return allNodes(rootPlan(json));
}

const COUNT_REGIMES = [
  {
    regime: 'a ceiling above the range',
    cap: COUNT_CAP,
    bounded: false,
    scans: ['Index Scan', 'Index Only Scan', 'Bitmap Index Scan'],
  },
  {
    regime: 'a ceiling inside the range',
    cap: 100,
    bounded: true,
    scans: ['Index Scan', 'Index Only Scan'],
  },
] as const;

describe('the plan each searched count is given', () => {
  describe.each(COUNT_CASES)('$label', (countCase) => {
    it.each(COUNT_REGIMES)(
      'reads one range of its index, never the table, under $regime',
      async ({ regime, cap, bounded, scans }) => {
        const nodes = await countPlan(countCase, cap, regime);
        const types = nodes.map((node) => node.nodeType);
        const scan = nodes.find((node) => node.indexName === countCase.index);

        expect(scans).toContain(scan?.nodeType);
        expect(scan?.indexCond).toContain(`${countCase.column} >=`);
        expect(scan?.indexCond).toContain(`${countCase.column} <`);
        expect(types).toContain('Limit');
        const seqScanned = nodes.filter((node) => node.nodeType === 'Seq Scan');
        expect(seqScanned.map((node) => node.relationName)).not.toContain(countCase.table);
        if (bounded || countCase.noSeqScan === true) expect(types).not.toContain('Seq Scan');
        if (bounded) expect(types).not.toContain('Sort');
      },
    );
  });
});

// Unsearched counts, and counts narrowed only by an exact filter, have no
// search range to read; they may still never read the counted table in
// full, since the tenant's own rows are an index range of it.
const UNSEARCHED_COUNT_CASES = [
  {
    label: 'subjects/count',
    tables: ['subjects'],
    throughOwner: false,
    count: scopedCount((tx, options) => countSubjects(tx, {}, new Date(), options)),
  },
  {
    label: 'subjects/count ?role=<id>',
    tables: ['subjects', 'subject_roles'],
    throughOwner: false,
    count: scopedCount((tx, options) =>
      countSubjects(tx, { role: heldRoleId }, new Date(), options),
    ),
  },
  {
    label: 'clients/count',
    tables: ['clients', 'client_oidc_config'],
    throughOwner: false,
    count: scopedCount((tx, options) => countClients(tx, {}, options)),
  },
  {
    label: 'clients/count ?type=public',
    tables: ['clients', 'client_oidc_config'],
    throughOwner: false,
    count: scopedCount((tx, options) => countClients(tx, { type: 'public' }, options)),
  },
] as const;

describe('the plan each unsearched count is given', () => {
  describe.each(UNSEARCHED_COUNT_CASES)('$label', (countCase) => {
    it.each(COUNT_REGIMES)(
      'never scans the counted table, under $regime',
      async ({ regime, cap }) => {
        const nodes = await countPlan(countCase, cap, regime);
        const seqScanned = nodes
          .filter((node) => node.nodeType === 'Seq Scan')
          .map((node) => node.relationName);
        expect(nodes.map((node) => node.nodeType)).toContain('Limit');
        for (const table of countCase.tables) expect(seqScanned, table).not.toContain(table);
      },
    );
  });
});

// A listing narrowed by an exact filter, or ordered newest first, has its
// own index, and never reads its table whole. The paged ones read it in
// their own order; a type filter picks few enough rows that sorting them is
// the planner's cheaper choice, and is allowed.
interface IndexedListing {
  readonly label: string;
  readonly index: string;
  readonly sortless: boolean;
  readonly list: (tx: TenantScopedDatabase) => Promise<unknown>;
}

const INDEXED_LISTINGS: readonly IndexedListing[] = [
  {
    label: 'subjects ?type=service',
    index: 'subjects_by_type',
    sortless: false,
    list: (tx: TenantScopedDatabase) =>
      listSubjects(tx, {
        limit: 50,
        cursor: undefined,
        cursorKey: CURSOR_KEY,
        tenantId: targetTenantId,
        filters: { type: 'service' },
        now: new Date(),
      }),
  },
  {
    label: 'groups ?parent=<id>',
    index: 'groups_by_parent',
    sortless: true,
    list: (tx: TenantScopedDatabase) =>
      listGroups(tx, {
        limit: 50,
        cursor: undefined,
        cursorKey: CURSOR_KEY,
        tenantId: targetTenantId,
        filters: { parent: parentGroupId },
      }),
  },
  {
    label: 'mail',
    index: 'email_outbox_recent',
    sortless: true,
    list: (tx: TenantScopedDatabase) =>
      listMail(tx, {
        tenantId: targetTenantId,
        revealRecipients: true,
        maxAttempts: 5,
        limit: 50,
        cursor: undefined,
        cursorKey: CURSOR_KEY,
      }),
  },
  {
    label: 'clients/:id/logout-deliveries',
    index: 'backchannel_logout_deliveries_recent',
    sortless: true,
    list: (tx: TenantScopedDatabase) =>
      listLogoutDeliveries(tx, {
        tenantId: targetTenantId,
        clientDbId: scopedClientId,
        limit: 50,
        cursor: undefined,
        cursorKey: CURSOR_KEY,
      }),
  },
];

describe('the plan each indexed listing is given', () => {
  it.each(INDEXED_LISTINGS)('$label reads its index in order, with no sort', async (listing) => {
    const { statement } = await issuedBy(async () => {
      await withTenant(app.db, targetTenantId, (tx) => listing.list(tx));
      return null;
    });
    const [json] = await explained(app, statement, 'FORMAT JSON', targetTenantId);
    const nodes = allNodes(rootPlan(json));
    const types = nodes.map((node) => node.nodeType);
    expect(nodes.some((node) => node.indexName === listing.index)).toBe(true);
    if (listing.sortless) expect(types).not.toContain('Sort');
    expect(types).not.toContain('Seq Scan');
    await recordPlan(listing.label, statement);
  });
});
