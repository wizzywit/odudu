import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { tenantDomainRepository } from '@odudu/domain-tenant';
import { tenantLookupRepository } from '@odudu/protocol-oidc';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed, type DomainCommandResult } from '#/cli/seed';

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;

const BASE = 'https://auth.operator-host.io';

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 5 });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = Buffer.alloc(32, 7).toString('base64');
  process.env.ODUDU_PUBLIC_BASE_URL = BASE;
}, 120_000);

afterAll(async () => {
  Reflect.deleteProperty(process.env, 'ODUDU_DATABASE_URL');
  Reflect.deleteProperty(process.env, 'ODUDU_APP_DATABASE_URL');
  Reflect.deleteProperty(process.env, 'ODUDU_KEK');
  Reflect.deleteProperty(process.env, 'ODUDU_PUBLIC_BASE_URL');
  await appDb.close();
  await owner.close();
  await container.stop();
});

let counter = 0;
async function tenant(): Promise<{ name: string; id: string }> {
  counter += 1;
  const name = `dom-${String(counter)}-${Math.random().toString(36).slice(2, 8)}`;
  await seed(['tenant', '--name', name]);
  const found = await tenantLookupRepository(owner.db).byName(name);
  if (found === null) throw new Error('tenant not created');
  return { name, id: found.id };
}

async function run(args: string[]): Promise<DomainCommandResult> {
  const result = await seed(['domain', ...args]);
  if (!('command' in result) || result.command !== 'domain') throw new Error('not a domain result');
  return result;
}

const rows = (tenantId: string) =>
  withTenant(appDb.db, tenantId, (tx) => tenantDomainRepository(tx).list(tenantId));
const retired = (tenantId: string) =>
  withTenant(appDb.db, tenantId, (tx) =>
    tenantDomainRepository(tx).listRetired(tenantId, new Date()),
  );

describe('seed domain', () => {
  it('registers a pending domain and prints its challenge', async () => {
    const t = await tenant();
    const result = await run(['--tenant', t.name, '--host', 'Login.Pending-One.org']);
    expect(result).toMatchObject({
      host: 'login.pending-one.org',
      state: 'pending',
      canonical: false,
      created: true,
    });
    expect(result.recordName).toBe('_odudu-challenge.login.pending-one.org');
    expect(result.recordValue).toMatch(/^odudu-domain-verification=/);
    expect((await rows(t.id))[0]).toMatchObject({
      state: 'pending',
      challenge: result.recordValue,
    });
  });

  it('applies the host rules of the admin API', async () => {
    const t = await tenant();
    await expect(run(['--tenant', t.name, '--host', 'localhost'])).rejects.toThrow(
      /domain_host_localhost/,
    );
    await expect(run(['--tenant', t.name, '--host', '10.0.0.1'])).rejects.toThrow(
      /domain_host_ip_literal/,
    );
    await seed(['admin', '--username', 'root']);
    await expect(run(['--tenant', 'system', '--host', 'login.system-try.org'])).rejects.toThrow(
      /domain_system_tenant/,
    );
    expect(await rows(t.id)).toHaveLength(0);
  });

  it('verifies without DNS and makes the domain canonical through a retirement', async () => {
    const t = await tenant();
    const result = await run([
      '--tenant',
      t.name,
      '--host',
      'login.canon-one.org',
      '--assume-verified',
      '--canonical',
    ]);
    expect(result).toMatchObject({ state: 'verified', canonical: true });
    expect(result.recordName).toBeUndefined();
    expect((await rows(t.id))[0]).toMatchObject({ state: 'verified', canonical: true });
    const gone = await retired(t.id);
    expect(gone.map((r) => r.issuer)).toEqual([`${BASE}/tenants/${t.name}`]);
  });

  it('is a no-op on a repeat, and adds only what the flags ask', async () => {
    const t = await tenant();
    const args = ['--tenant', t.name, '--host', 'login.repeat-one.org'];
    const first = await run(args);
    const again = await run(args);
    expect(again).toMatchObject({ created: false, state: 'pending' });
    expect(again.recordValue).toBe(first.recordValue);
    const verified = await run([...args, '--assume-verified']);
    expect(verified).toMatchObject({ created: false, state: 'verified', canonical: false });
    const canonical = await run([...args, '--canonical']);
    expect(canonical).toMatchObject({ state: 'verified', canonical: true });
    const before = await retired(t.id);
    const twice = await run([...args, '--assume-verified', '--canonical']);
    expect(twice).toMatchObject({ state: 'verified', canonical: true, created: false });
    expect(await retired(t.id)).toEqual(before);
    expect(await rows(t.id)).toHaveLength(1);
  });

  it('refuses --canonical on an unverified domain and keeps nothing', async () => {
    const t = await tenant();
    await expect(
      run(['--tenant', t.name, '--host', 'login.unproven.org', '--canonical']),
    ).rejects.toThrow(/not verified/);
    expect(await rows(t.id)).toHaveLength(0);
    expect(await retired(t.id)).toHaveLength(0);
  });

  it('does not let --assume-verified take a host another tenant verified', async () => {
    const a = await tenant();
    const b = await tenant();
    await run(['--tenant', a.name, '--host', 'login.contested.org', '--assume-verified']);
    await expect(
      run(['--tenant', b.name, '--host', 'login.contested.org', '--assume-verified']),
    ).rejects.toThrow(/domain_verified_elsewhere/);
    expect((await rows(b.id))[0]).toBeUndefined();
  });

  it('refuses an unknown tenant', async () => {
    await expect(
      run(['--tenant', 'nobody-here', '--host', 'login.nobody.org']),
    ).rejects.toMatchObject({
      code: 'seed_not_found',
    });
  });
});
