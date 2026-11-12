import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { breachedPasswordRepository, insertBreachedHashes } from '#/repository/breached-passwords';
import { breachedHash } from '#/service/breached-password';
import { type RangeFetch } from '#/service/breached-range-source';
import { createBreachedPasswordCheck } from '#/usecase/breached-password-check';

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

async function tenantWith(settings: { breachedCheck: string; breachedOnError: string }) {
  const id = newId();
  await owner.db.insert(tenants).values({ id, name: `tenant-${id}`, ...settings });
  return id;
}

const KNOWN = 'a password in the corpus';
const UNKNOWN = 'a password nowhere to be found';

describe('the dataset', () => {
  it('loads a chunk once and a second time adds nothing', async () => {
    const { prefix, suffix } = breachedHash(KNOWN);
    const rows = [{ prefix, suffix }];
    expect(await insertBreachedHashes(owner.db, rows)).toBe(1);
    expect(await insertBreachedHashes(owner.db, rows)).toBe(0);
  });

  it('refuses a row that is not a prefix and a suffix', async () => {
    await expect(
      insertBreachedHashes(owner.db, [{ prefix: 'abcde', suffix: 'F'.repeat(35) }]),
    ).rejects.toThrow();
  });

  it('is read inside a tenant, and only read', async () => {
    const tenantId = await tenantWith({ breachedCheck: 'dataset', breachedOnError: 'open' });
    await withTenant(app.db, tenantId, async (tx) => {
      const source = breachedPasswordRepository(tx).datasetSource();
      expect(await source.isBreached(KNOWN)).toBe(true);
      expect(await source.isBreached(UNKNOWN)).toBe(false);
    });
    await expect(
      withTenant(app.db, tenantId, (tx) =>
        tx.execute(sql`insert into breached_password_hashes values ('00000', ${'0'.repeat(35)})`),
      ),
    ).rejects.toThrow();
  });

  it('reads nothing without a tenant bound', async () => {
    const rows = await app.sql`select count(*)::int as n from breached_password_hashes`;
    expect(rows[0]?.n).toBe(0);
  });

  it('reads the settings of the tenant in context and of no other', async () => {
    const other = await tenantWith({ breachedCheck: 'remote', breachedOnError: 'closed' });
    const own = await tenantWith({ breachedCheck: 'off', breachedOnError: 'open' });
    await withTenant(app.db, own, async (tx) => {
      const repository = breachedPasswordRepository(tx);
      expect(await repository.settings(own)).toEqual({ check: 'off', onError: 'open' });
      await expect(repository.settings(other)).rejects.toThrow('no breached-password settings');
    });
  });
});

function fetchCapturing(answer: string) {
  const urls: string[] = [];
  const fetchRange: RangeFetch = (url) => {
    urls.push(url.href);
    return Promise.resolve({ status: 200, body: answer });
  };
  return { fetchRange, urls };
}

describe('the check a password write calls', () => {
  it('does nothing for a tenant that switched it off', async () => {
    const tenantId = await tenantWith({ breachedCheck: 'off', breachedOnError: 'open' });
    const { fetchRange, urls } = fetchCapturing('');
    const check = createBreachedPasswordCheck({ fetchRange });
    const verdict = await withTenant(app.db, tenantId, (tx) => check(tx, tenantId, KNOWN));
    expect(verdict).toEqual({ audit: 'off', violations: [] });
    expect(urls).toEqual([]);
  });

  it('judges by the dataset and sends nothing out', async () => {
    const tenantId = await tenantWith({ breachedCheck: 'dataset', breachedOnError: 'open' });
    const { fetchRange, urls } = fetchCapturing('');
    const check = createBreachedPasswordCheck({ fetchRange });
    const verdict = await withTenant(app.db, tenantId, (tx) => check(tx, tenantId, KNOWN));
    expect(verdict.audit).toBe('breached');
    expect(verdict.violations.map((v) => v.rule)).toEqual(['breached-password']);
    expect(urls).toEqual([]);
  });

  it('judges by the range lookup for a remote tenant', async () => {
    const tenantId = await tenantWith({ breachedCheck: 'remote', breachedOnError: 'open' });
    const { prefix, suffix } = breachedHash(UNKNOWN);
    const { fetchRange, urls } = fetchCapturing(`${suffix}:12\r\n${'A'.repeat(35)}:0`);
    const check = createBreachedPasswordCheck({ fetchRange });
    const verdict = await withTenant(app.db, tenantId, (tx) => check(tx, tenantId, UNKNOWN));
    expect(verdict.audit).toBe('breached');
    expect(urls).toEqual([`https://api.pwnedpasswords.com/range/${prefix}`]);
  });

  it('settles a failed lookup by the tenant’s setting', async () => {
    const down: RangeFetch = () => Promise.reject(new Error('unreachable'));
    const check = createBreachedPasswordCheck({ fetchRange: down });
    const open = await tenantWith({ breachedCheck: 'remote', breachedOnError: 'open' });
    const closed = await tenantWith({ breachedCheck: 'remote', breachedOnError: 'closed' });
    expect((await withTenant(app.db, open, (tx) => check(tx, open, UNKNOWN))).audit).toBe(
      'error_open',
    );
    const refused = await withTenant(app.db, closed, (tx) => check(tx, closed, UNKNOWN));
    expect(refused.audit).toBe('error_closed');
    expect(refused.violations.map((v) => v.rule)).toEqual(['breach-check-unavailable']);
  });
});
