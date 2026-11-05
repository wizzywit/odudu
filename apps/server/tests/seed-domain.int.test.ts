import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { tenantDomainRepository } from '@odudu/domain-tenant';
import { sql } from 'drizzle-orm';
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
  withTenant(appDb.db, tenantId, (tx) => tenantDomainRepository(tx).page(tenantId, { limit: 50 }));
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

  it('registers, unverified, a host another tenant already verified', async () => {
    const a = await tenant();
    const b = await tenant();
    await run(['--tenant', a.name, '--host', 'login.claimed.org', '--assume-verified']);
    const result = await run(['--tenant', b.name, '--host', 'login.claimed.org']);
    expect(result).toMatchObject({ state: 'pending', canonical: false, created: true });
    expect((await rows(b.id))[0]).toMatchObject({ state: 'pending' });
    expect((await rows(a.id))[0]).toMatchObject({ state: 'verified' });
  });

  it('says which setting a missing base address needs', async () => {
    const t = await tenant();
    const kept = process.env.ODUDU_PUBLIC_BASE_URL;
    Reflect.deleteProperty(process.env, 'ODUDU_PUBLIC_BASE_URL');
    try {
      await expect(run(['--tenant', t.name, '--host', 'login.nobase.org'])).rejects.toThrow(
        /domain_no_base_url: ODUDU_PUBLIC_BASE_URL is required/,
      );
    } finally {
      process.env.ODUDU_PUBLIC_BASE_URL = kept;
    }
  });

  it('reads NODE_ENV from the configuration to refuse --assume-verified in production', async () => {
    const t = await tenant();
    const kept = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(
        run(['--tenant', t.name, '--host', 'login.prod-run.org', '--assume-verified']),
      ).rejects.toMatchObject({ code: 'domain_assume_verified_production' });
      expect(await rows(t.id)).toHaveLength(0);
      expect(await run(['--tenant', t.name, '--host', 'login.prod-run.org'])).toMatchObject({
        state: 'pending',
      });
    } finally {
      process.env.NODE_ENV = kept;
    }
  });

  it('refuses an unknown tenant', async () => {
    await expect(
      run(['--tenant', 'nobody-here', '--host', 'login.nobody.org']),
    ).rejects.toMatchObject({
      code: 'seed_not_found',
    });
  });

  it('takes the tenant lock before it locks the row it verifies', async () => {
    const t = await tenant();
    const args = ['--tenant', t.name, '--host', 'login.lock-order.org'];
    await run(args);
    const [row] = await rows(t.id);
    if (row === undefined) throw new Error('no row');

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held: () => void = () => undefined;
    const taken = new Promise<void>((resolve) => {
      held = resolve;
    });
    const holder = withTenant(appDb.db, t.id, async (tx) => {
      await tenantDomainRepository(tx).lock(t.id);
      held();
      await gate;
    });
    await taken;
    const seeding = run([...args, '--assume-verified', '--canonical']);
    try {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const waiting = await owner.db.execute<{ n: number } & Record<string, unknown>>(
          sql`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock'`,
        );
        if ((waiting[0]?.n ?? 0) > 0) break;
        if (attempt === 199) throw new Error('the seed never waited on the tenant lock');
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const free = await owner.db.execute(
        sql`select id from tenant_domains where id = ${row.id} for update skip locked`,
      );
      expect(free).toHaveLength(1);
    } finally {
      release();
      await holder;
    }
    expect(await seeding).toMatchObject({ state: 'verified', canonical: true });
  });
});
