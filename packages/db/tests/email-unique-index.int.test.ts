import { readFileSync } from 'node:fs';
import path from 'node:path';
import { newId } from '@odudu/kernel';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';
import { ensureUniqueEmailIndex, EMAIL_INDEX_LOCK } from '#/email-unique-index';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate';

// One address is one account whatever its case. The index is what keeps a
// writer that skips the application's lock from making a second.

let container: TestDatabase;
let owner: DatabaseHandle;

const INDEX = 'users_email_search_unique';
const MIGRATION = readFileSync(path.join(MIGRATIONS_DIR, '0139_users_email_unique.sql'), 'utf8');

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
}, 120_000);

afterAll(async () => {
  await owner.close();
  await container.stop();
});

async function indexDefinition(): Promise<string | null> {
  const rows = await owner.sql<{ indexdef: string }[]>`
    select indexdef from pg_indexes where indexname = ${INDEX}`;
  return rows[0]?.indexdef ?? null;
}

async function tenant(): Promise<string> {
  const id = newId();
  await owner.sql`insert into tenants (id, name) values (${id}, ${`t-${id.slice(-12)}`})`;
  return id;
}

async function user(tenantId: string, email: string | null): Promise<void> {
  const subject = newId();
  await owner.sql`insert into subjects (id, tenant_id, type) values (${subject}, ${tenantId}, 'user')`;
  await owner.sql`
    insert into users (subject_id, tenant_id, username, email)
    values (${subject}, ${tenantId}, ${`u-${subject.slice(-12)}`}, ${email})`;
}

describe('the unique address index', () => {
  it('is there after the migrations, partial and over the tenant and the lower-cased address', async () => {
    const definition = await indexDefinition();
    expect(definition, 'the index was dropped or never built').not.toBeNull();
    expect(definition).toMatch(/UNIQUE INDEX/u);
    expect(definition).toMatch(/\(tenant_id, email_search\)/u);
    expect(definition).toMatch(/WHERE \(?email_search IS NOT NULL/u);
  });

  it('refuses a second account whose address differs only by case, in the same tenant', async () => {
    const t = await tenant();
    await user(t, 'Ada@example.com');
    await expect(user(t, 'ada@example.com')).rejects.toThrow(
      /users_email_search_unique|duplicate key/iu,
    );
  });

  it('lets another tenant hold the same address, and any number of accounts hold none', async () => {
    const a = await tenant();
    const b = await tenant();
    await user(a, 'grace@example.com');
    await user(b, 'grace@example.com');
    const c = await tenant();
    await user(c, null);
    await user(c, null);
    const held = await owner.sql`select 1 from users where tenant_id = ${c} and email is null`;
    expect(held).toHaveLength(2);
  });
});

describe('over a database that holds a pair of accounts differing by case', () => {
  async function withPair<T>(run: (t: string) => Promise<T>): Promise<T> {
    const t = await tenant();
    await owner.sql`drop index ${owner.sql(INDEX)}`;
    await user(t, 'Pair@example.com');
    await user(t, 'pair@example.com');
    try {
      return await run(t);
    } finally {
      await owner.sql`update users set email = null where tenant_id = ${t}`;
      await owner.sql.unsafe(
        `create unique index if not exists ${INDEX} on users (tenant_id, email_search) where email_search is not null`,
      );
    }
  }

  it('does not fail the migration, and builds nothing', async () => {
    await withPair(async () => {
      await owner.sql.unsafe(MIGRATION);
      expect(await indexDefinition()).toBeNull();
    });
  });

  it('is left blocked by the start-up step, which says so, and builds once the pair is gone', async () => {
    await withPair(async (t) => {
      expect(await ensureUniqueEmailIndex(owner.sql)).toBe('blocked');
      expect(await indexDefinition()).toBeNull();
      await owner.sql`update users set email = null where tenant_id = ${t}`;
      expect(await ensureUniqueEmailIndex(owner.sql)).toBe('built');
      expect(await indexDefinition()).not.toBeNull();
      expect(await ensureUniqueEmailIndex(owner.sql)).toBe('present');
    });
  });
});

describe('the start-up step', () => {
  async function absent(): Promise<void> {
    await owner.sql`drop index if exists ${owner.sql(INDEX)}`;
  }

  it('builds it once when two instances start at the same moment, and neither says blocked', async () => {
    await absent();
    const outcomes = await Promise.all([
      ensureUniqueEmailIndex(owner.sql),
      ensureUniqueEmailIndex(owner.sql),
      ensureUniqueEmailIndex(owner.sql),
    ]);
    expect(outcomes.filter((outcome) => outcome === 'built')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'blocked')).toHaveLength(0);
    expect(await indexDefinition()).not.toBeNull();
  }, 60_000);

  it('gives up waiting for a build that another instance holds, and builds nothing itself', async () => {
    await absent();
    const holder = await owner.sql.reserve();
    try {
      await holder`select pg_advisory_lock(${EMAIL_INDEX_LOCK})`;
      expect(await ensureUniqueEmailIndex(owner.sql, { waitMs: 300, pollMs: 50 })).toBe('skipped');
      expect(await indexDefinition()).toBeNull();
    } finally {
      await holder`select pg_advisory_unlock(${EMAIL_INDEX_LOCK})`;
      holder.release();
    }
    expect(await ensureUniqueEmailIndex(owner.sql)).toBe('built');
  });

  it('replaces an index an interrupted build left invalid', async () => {
    await owner.sql`
      update pg_index set indisvalid = false where indexrelid = ${INDEX}::regclass`;
    expect(await ensureUniqueEmailIndex(owner.sql)).toBe('built');
    const valid = await owner.sql<{ indisvalid: boolean }[]>`
      select indisvalid from pg_index where indexrelid = ${INDEX}::regclass`;
    expect(valid[0]?.indisvalid).toBe(true);
  });
});
