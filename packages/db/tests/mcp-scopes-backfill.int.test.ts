import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate';
import { withTenant } from '#/tx';

const TAG = '0113_mcp_scopes';

let containerHandle: TestDatabase | undefined;
let dbHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let before: string | undefined;

function handle(): DatabaseHandle {
  if (dbHandle === undefined) throw new Error('database not started');
  return dbHandle;
}

interface ScopeRow {
  tenant: string;
  name: string;
  description: string | null;

  include_in_id_token: boolean;
  include_in_access_token: boolean;
  default_client_assignment: string | null;
}

async function mcpScopes(): Promise<ScopeRow[]> {
  return handle().sql<ScopeRow[]>`
    select t.name as tenant, s.name, s.description, s.include_in_id_token,
           s.include_in_access_token, s.default_client_assignment
      from client_scopes s join tenants t on t.id = s.tenant_id
     where s.name in ('mcp:read', 'mcp:write')
     order by t.name, s.name`;
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  dbHandle = createDatabase(containerHandle.adminUrl);

  // The migrations before the one under test, so tenants exist without the scopes.
  before = mkdtempSync(join(tmpdir(), 'odudu-migrations-'));
  cpSync(MIGRATIONS_DIR, before, { recursive: true });
  const journalPath = join(before, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { tag: string }[];
  };
  journal.entries = journal.entries.filter((entry) => entry.tag < TAG);
  writeFileSync(journalPath, JSON.stringify(journal));
  await runMigrations(dbHandle.db, before);
}, 120_000);

afterAll(async () => {
  if (before !== undefined) rmSync(before, { recursive: true, force: true });
  await appHandle?.close();
  await dbHandle?.close();
  await containerHandle?.stop();
});

describe('the MCP scopes backfill', () => {
  it('gives every existing tenant both scopes, keeps one it already had, and runs again to no effect', async () => {
    const raw = handle().sql;
    await raw`insert into tenants (id, name) values (gen_random_uuid(), 'plain'), (gen_random_uuid(), 'owner')`;
    await raw`
      insert into client_scopes (id, tenant_id, name, description, default_client_assignment)
      select gen_random_uuid(), id, 'mcp:read', 'the owner wrote this', 'optional'
        from tenants where name = 'owner'`;
    const others = await raw<{ n: number }[]>`
      select count(*)::int as n from client_scopes where name not in ('mcp:read', 'mcp:write', 'me:read', 'me:write')`;

    await runMigrations(handle().db, MIGRATIONS_DIR);
    const once = await mcpScopes();
    expect(once.map((row) => `${row.tenant}/${row.name}`)).toEqual([
      'owner/mcp:read',
      'owner/mcp:write',
      'plain/mcp:read',
      'plain/mcp:write',
    ]);
    const kept = once.find((row) => row.tenant === 'owner' && row.name === 'mcp:read');
    expect(kept).toMatchObject({
      description: 'the owner wrote this',
      default_client_assignment: 'optional',
    });
    for (const row of once.filter((r) => r !== kept)) {
      expect(row.default_client_assignment).toBeNull();
      expect(row.include_in_id_token).toBe(false);
      expect(row.include_in_access_token).toBe(true);
      expect(row.description).toMatch(/\S/u);
    }

    await raw`delete from drizzle.__drizzle_migrations where created_at = (
      select max(created_at) from drizzle.__drizzle_migrations)`;
    await runMigrations(handle().db, MIGRATIONS_DIR);
    expect(await mcpScopes()).toEqual(once);
    const after = await raw<{ n: number }[]>`
      select count(*)::int as n from client_scopes where name not in ('mcp:read', 'mcp:write', 'me:read', 'me:write')`;
    expect(after[0]?.n).toBe(others[0]?.n);
  });

  it("shows a tenant its own two scopes and none of another's", async () => {
    const urls = containerHandle;
    if (urls === undefined) throw new Error('database not started');
    appHandle = createDatabase(await createAppRole(urls.adminUrl), { max: 2 });
    const tenants = await handle().sql<{ id: string; name: string }[]>`
      select id, name from tenants where name in ('plain', 'owner')`;
    for (const tenant of tenants) {
      const seen = await withTenant(appHandle.db, tenant.id, (tx) =>
        tx.execute<{ tenant_id: string; name: string }>(
          sql`select tenant_id, name from client_scopes where name in ('mcp:read', 'mcp:write')`,
        ),
      );
      expect(seen.map((row) => row.name).sort()).toEqual(['mcp:read', 'mcp:write']);
      expect(new Set(seen.map((row) => row.tenant_id))).toEqual(new Set([tenant.id]));
    }
  });

  it('leaves row security forced on the table', async () => {
    const rows = await handle().sql<{ relforcerowsecurity: boolean }[]>`
      select relforcerowsecurity from pg_class where relname = 'client_scopes'`;
    expect(rows[0]?.relforcerowsecurity).toBe(true);
  });
});
