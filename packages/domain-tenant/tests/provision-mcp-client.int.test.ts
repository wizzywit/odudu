import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import {
  clientRepository,
  clientScopeRepository,
  MCP_CLIENT_ID,
  provisionMcpClient,
  provisionTenantDefaults,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

async function freshTenant(): Promise<string> {
  const tenantId = newId();
  await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `t-${tenantId}` });
    await provisionTenantDefaults(tx, tenantId);
  });
  return tenantId;
}

async function assignments(tenantId: string, clientDbId: string): Promise<Record<string, string>> {
  return withTenant(app.db, tenantId, async (tx) => {
    const held = await clientScopeRepository(tx).forClientByAssignment(clientDbId);
    return Object.fromEntries(held.map(({ scope, assignment }) => [scope.name, assignment]));
  });
}

describe('provisionMcpClient', () => {
  it('creates the built-in public client with mcp:read by default and mcp:write optional', async () => {
    const tenantId = await freshTenant();
    const client = await withTenant(app.db, tenantId, (tx) => provisionMcpClient(tx, tenantId));
    expect(client).toMatchObject({
      clientId: MCP_CLIENT_ID,
      tenantId,
      type: 'public',
      secretHash: null,
      enabled: true,
      builtinMcp: true,
      builtinAdmin: false,
    });
    const held = await assignments(tenantId, client.id);
    expect(held['mcp:read']).toBe('default');
    expect(held['mcp:write']).toBe('optional');
    expect(held.openid).toBe('default');
  });

  it('is a no-op the second time: same row, nothing written', async () => {
    const tenantId = await freshTenant();
    const first = await withTenant(app.db, tenantId, (tx) => provisionMcpClient(tx, tenantId));
    const before = await owner.sql<{ xmin: string }[]>`
      select xmin::text as xmin from clients where id = ${first.id}`;
    const second = await withTenant(app.db, tenantId, (tx) => provisionMcpClient(tx, tenantId));
    expect(second.id).toBe(first.id);
    const after = await owner.sql<{ xmin: string }[]>`
      select xmin::text as xmin from clients where id = ${first.id}`;
    expect(after[0]?.xmin).toBe(before[0]?.xmin);
    const count = await owner.sql<{ n: number }[]>`
      select count(*)::int as n from clients where tenant_id = ${tenantId}`;
    expect(count[0]?.n).toBe(1);
    expect(Object.keys(await assignments(tenantId, first.id)).length).toBe(
      (await owner.sql`select 1 from client_scope_assignments where client_id = ${first.id}`)
        .length,
    );
  });

  it('refuses a client holding the id that is not the built-in one', async () => {
    const tenantId = await freshTenant();
    await withTenant(app.db, tenantId, (tx) =>
      clientRepository(tx).create({
        tenantId,
        clientId: MCP_CLIENT_ID,
        name: 'Impostor',
        type: 'public',
        secretHash: null,
      }),
    );
    await expect(
      withTenant(app.db, tenantId, (tx) => provisionMcpClient(tx, tenantId)),
    ).rejects.toMatchObject({ code: 'mcp_client_not_builtin' });
  });

  it('keeps the marker to one client a tenant', async () => {
    const tenantId = await freshTenant();
    await withTenant(app.db, tenantId, (tx) => provisionMcpClient(tx, tenantId));
    await expect(
      withTenant(app.db, tenantId, (tx) =>
        clientRepository(tx).create({
          tenantId,
          clientId: 'second',
          name: 'Second',
          type: 'public',
          secretHash: null,
          builtinMcp: true,
        }),
      ),
    ).rejects.toThrow();
  });

  it("is invisible from another tenant, and another tenant's session cannot write into it", async () => {
    const mine = await freshTenant();
    const theirs = await freshTenant();
    const client = await withTenant(app.db, mine, (tx) => provisionMcpClient(tx, mine));
    await withTenant(app.db, theirs, async (tx) => {
      expect(await clientRepository(tx).byClientId(MCP_CLIENT_ID)).toBeNull();
      expect(await clientRepository(tx).byId(client.id)).toBeNull();
    });
    await expect(
      withTenant(app.db, theirs, (tx) => provisionMcpClient(tx, mine)),
    ).rejects.toThrow();
    const rows = await owner.sql<{ n: number }[]>`
      select count(*)::int as n from clients where tenant_id = ${mine}`;
    expect(rows[0]?.n).toBe(1);
  });

  it('skips a scope the tenant no longer defines rather than failing', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `t-${tenantId}` });
    });
    const client = await withTenant(app.db, tenantId, (tx) => provisionMcpClient(tx, tenantId));
    expect(await assignments(tenantId, client.id)).toEqual({});
  });
});
