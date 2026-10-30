import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe, expectTenantIsolation } from '@odudu/db/testing';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_MESSAGE_OVERRIDES,
  messageOverrideRepository,
  type OverridePrecondition,
} from '#/repository/message-overrides';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 8 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

const KNOWN = new Set(['login.title', 'login.submit', 'consent.title']);
const isKnownKey = (key: string): boolean => KNOWN.has(key) || key.startsWith('bulk.');
const repo = (tx: TenantScopedDatabase) => messageOverrideRepository(tx, { isKnownKey });

async function newTenant(): Promise<string> {
  const tenantId = newId();
  await withTenant(app.db, tenantId, (tx) =>
    tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` }),
  );
  return tenantId;
}

const put = (tenantId: string, locale: string, key: string, message = 'text') =>
  withTenant(app.db, tenantId, (tx) => repo(tx).put({ tenantId, locale, key, message }));

describe('put', () => {
  it('stores an override and replaces it on a second put', async () => {
    const tenantId = await newTenant();
    expect(await put(tenantId, 'fr', 'login.title', 'Connexion')).toBe('ok');
    expect(await put(tenantId, 'fr', 'login.title', 'Se connecter')).toBe('ok');
    const rows = await withTenant(app.db, tenantId, (tx) =>
      repo(tx).list(tenantId, 'fr', { limit: 10 }),
    );
    expect(rows.map(({ key, message }) => [key, message])).toEqual([
      ['login.title', 'Se connecter'],
    ]);
  });

  it('refuses a key the English catalogue does not hold', async () => {
    const tenantId = await newTenant();
    expect(await put(tenantId, 'fr', 'login.nonesuch')).toBe('unknown_key');
    expect(await put(tenantId, 'fr', 'constructor')).toBe('unknown_key');
    expect(await put(tenantId, 'fr', '')).toBe('unknown_key');
    expect(await withTenant(app.db, tenantId, (tx) => repo(tx).forRender(tenantId, 'fr'))).toEqual(
      {},
    );
  });

  it.each(['', 'e', 'english', 'en_US', '../etc', 'fr-CAN-x', 'fr\n'])(
    'refuses the locale tag %j, which fails isValidLocale',
    async (locale) => {
      const tenantId = await newTenant();
      expect(await put(tenantId, locale, 'login.title')).toBe('invalid_locale');
    },
  );

  it('keeps one spelling of a locale however it was typed', async () => {
    const tenantId = await newTenant();
    await put(tenantId, 'FR-ca', 'login.title', 'Allo');
    await put(tenantId, 'fr-CA', 'login.title', 'Allô');
    const held = await withTenant(app.db, tenantId, (tx) => repo(tx).forRender(tenantId, 'fr-ca'));
    expect(held).toEqual({ 'login.title': 'Allô' });
  });

  it('refuses the 501st override and still lets an existing one change', async () => {
    const tenantId = await newTenant();
    await withTenant(app.db, tenantId, async (tx) => {
      for (let n = 0; n < MAX_MESSAGE_OVERRIDES; n += 1) {
        const outcome = await repo(tx).put({
          tenantId,
          locale: n % 2 === 0 ? 'fr' : 'de',
          key: `bulk.${String(n)}`,
          message: 'x',
        });
        expect(outcome).toBe('ok');
      }
    });
    expect(await put(tenantId, 'es', 'login.title')).toBe('over_bound');
    expect(await put(tenantId, 'fr', 'bulk.0', 'changed')).toBe('ok');
    const count =
      await owner.sql`select count(*)::int as n from message_overrides where tenant_id = ${tenantId}`;
    expect(count[0]?.n).toBe(MAX_MESSAGE_OVERRIDES);
  });

  it('does not let concurrent puts pass the bound', async () => {
    const tenantId = await newTenant();
    await withTenant(app.db, tenantId, async (tx) => {
      for (let n = 0; n < MAX_MESSAGE_OVERRIDES - 2; n += 1) {
        await repo(tx).put({ tenantId, locale: 'fr', key: `bulk.${String(n)}`, message: 'x' });
      }
    });
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, (_, n) => put(tenantId, 'de', `bulk.late${String(n)}`)),
    );
    expect(outcomes.filter((outcome) => outcome === 'ok')).toHaveLength(2);
    expect(outcomes.filter((outcome) => outcome === 'over_bound')).toHaveLength(4);
    const count =
      await owner.sql`select count(*)::int as n from message_overrides where tenant_id = ${tenantId}`;
    expect(count[0]?.n).toBe(MAX_MESSAGE_OVERRIDES);
  });

  it('counts per tenant, so one tenant at the bound does not hold another back', async () => {
    const full = await newTenant();
    await withTenant(app.db, full, async (tx) => {
      for (let n = 0; n < MAX_MESSAGE_OVERRIDES; n += 1) {
        await repo(tx).put({
          tenantId: full,
          locale: 'fr',
          key: `bulk.${String(n)}`,
          message: 'x',
        });
      }
    });
    const other = await newTenant();
    expect(await put(other, 'fr', 'login.title')).toBe('ok');
  });

  it('stores markup as the text it is, and the database refuses an empty or oversized one', async () => {
    const tenantId = await newTenant();
    expect(await put(tenantId, 'en', 'login.title', '<script>alert(1)</script>')).toBe('ok');
    const held = await withTenant(app.db, tenantId, (tx) => repo(tx).forRender(tenantId, 'en'));
    expect(held['login.title']).toBe('<script>alert(1)</script>');
    await expect(put(tenantId, 'en', 'login.submit', '')).rejects.toThrow();
    await expect(put(tenantId, 'en', 'login.submit', 'x'.repeat(2001))).rejects.toThrow();
  });
});

describe('get', () => {
  it('reads one override, under the locale spelled canonically', async () => {
    const tenantId = await newTenant();
    await put(tenantId, 'fr-CA', 'login.title', 'Allô');
    const read = (locale: string, key: string) =>
      withTenant(app.db, tenantId, (tx) => repo(tx).get(tenantId, locale, key));
    expect(await read('FR-ca', 'login.title')).toMatchObject({
      locale: 'fr-CA',
      key: 'login.title',
      message: 'Allô',
    });
    expect(await read('fr-CA', 'login.submit')).toBeNull();
    expect(await read('de', 'login.title')).toBeNull();
    expect(await read('not a tag', 'login.title')).toBeNull();
  });
});

describe('all', () => {
  it('reads every override of the tenant in locale and key order, and no one else’s', async () => {
    const tenantId = await newTenant();
    const other = await newTenant();
    await put(tenantId, 'fr', 'login.title');
    await put(tenantId, 'de', 'login.submit');
    await put(tenantId, 'de', 'login.title');
    await put(other, 'de', 'consent.title');
    const rows = await withTenant(app.db, tenantId, (tx) => repo(tx).all(tenantId));
    expect(rows.map((row) => `${row.locale}/${row.key}`)).toEqual([
      'de/login.submit',
      'de/login.title',
      'fr/login.title',
    ]);
    expect(await withTenant(app.db, other, (tx) => repo(tx).all(tenantId))).toEqual([]);
  });
});

describe('forMail', () => {
  const KEYS = ['login.title', 'login.submit'];

  it('reads the named keys in every language as maps, and shows another tenant’s transaction nothing', async () => {
    const tenantId = await newTenant();
    const other = await newTenant();
    await put(tenantId, 'fr', 'login.title', 'Bonjour');
    await put(tenantId, 'de', 'login.title', 'Hallo');
    await put(tenantId, 'de', 'login.submit', 'Los');
    await put(tenantId, 'de', 'consent.title', 'not asked for');
    await put(other, 'de', 'login.title', 'Nein');
    const read = (as: string, of: string, keys = KEYS) =>
      withTenant(app.db, as, (tx) => repo(tx).forMail(of, keys));
    expect(await read(tenantId, tenantId)).toEqual({
      fr: { 'login.title': 'Bonjour' },
      de: { 'login.title': 'Hallo', 'login.submit': 'Los' },
    });
    expect(await read(other, tenantId)).toEqual({});
    expect(await read(tenantId, other)).toEqual({});
    expect(await read(tenantId, tenantId, [])).toEqual({});
  });
});

describe('list', () => {
  it('pages by key under MAX_LIMIT and never returns another locale', async () => {
    const tenantId = await newTenant();
    await withTenant(app.db, tenantId, async (tx) => {
      for (let n = 0; n < 7; n += 1) {
        await repo(tx).put({ tenantId, locale: 'fr', key: `bulk.${String(n)}`, message: 'x' });
      }
      await repo(tx).put({ tenantId, locale: 'de', key: 'bulk.0', message: 'y' });
    });
    const keys: string[] = [];
    let after: string | undefined;
    for (let pages = 0; pages < 5; pages += 1) {
      const page = await withTenant(app.db, tenantId, (tx) =>
        repo(tx).list(tenantId, 'fr', { after, limit: 3 }),
      );
      keys.push(...page.map((row) => row.key));
      if (page.length < 3) break;
      after = page[page.length - 1]?.key;
    }
    expect(keys).toEqual(Array.from({ length: 7 }, (_, n) => `bulk.${String(n)}`));
  });

  it('never reads more than one more than MAX_LIMIT rows', async () => {
    const tenantId = await newTenant();
    await withTenant(app.db, tenantId, async (tx) => {
      for (let n = 0; n < 230; n += 1) {
        await repo(tx).put({ tenantId, locale: 'fr', key: `bulk.${String(n)}`, message: 'x' });
      }
    });
    const page = await withTenant(app.db, tenantId, (tx) =>
      repo(tx).list(tenantId, 'fr', { limit: 100_000 }),
    );
    expect(page).toHaveLength(201);
  });
});

describe('delete', () => {
  it('removes one override and says whether there was one', async () => {
    const tenantId = await newTenant();
    await put(tenantId, 'fr', 'login.title');
    const run = (locale: string) =>
      withTenant(app.db, tenantId, (tx) => repo(tx).delete(tenantId, locale, 'login.title'));
    expect(await run('de')).toBe('not_found');
    expect(await run('fr')).toBe('deleted');
    expect(await run('fr')).toBe('not_found');
  });
});

describe('a precondition', () => {
  const putIf = (tenantId: string, precondition: OverridePrecondition, message = 'next') =>
    withTenant(app.db, tenantId, (tx) =>
      repo(tx).put({ tenantId, locale: 'fr', key: 'login.title', message }, precondition),
    );
  const deleteIf = (tenantId: string, precondition: OverridePrecondition) =>
    withTenant(app.db, tenantId, (tx) =>
      repo(tx).delete(tenantId, 'fr', 'login.title', precondition),
    );

  it('is handed null for a key nothing is stored under, and the row for one that is', async () => {
    const tenantId = await newTenant();
    const seen: (string | null)[] = [];
    const record: OverridePrecondition = (stored) => {
      seen.push(stored?.message ?? null);
      return true;
    };
    expect(await putIf(tenantId, record, 'first')).toBe('ok');
    expect(await putIf(tenantId, record, 'second')).toBe('ok');
    expect(seen).toEqual([null, 'first']);
  });

  it('stops a put it refuses, before the bound and before anything is written', async () => {
    const tenantId = await newTenant();
    await put(tenantId, 'fr', 'login.title', 'kept');
    expect(await putIf(tenantId, () => false)).toBe('precondition_failed');
    const held = await withTenant(app.db, tenantId, (tx) => repo(tx).forRender(tenantId, 'fr'));
    expect(held).toEqual({ 'login.title': 'kept' });
  });

  it('stops a delete it refuses, and answers not_found before asking', async () => {
    const tenantId = await newTenant();
    let asked = 0;
    const refuse: OverridePrecondition = () => {
      asked += 1;
      return false;
    };
    expect(await deleteIf(tenantId, refuse)).toBe('not_found');
    expect(asked).toBe(0);
    await put(tenantId, 'fr', 'login.title', 'kept');
    expect(await deleteIf(tenantId, refuse)).toBe('precondition_failed');
    expect(await deleteIf(tenantId, () => true)).toBe('deleted');
  });

  it('is judged with the tenant’s writers serialised: only one of two creates wins', async () => {
    const tenantId = await newTenant();
    const create: OverridePrecondition = (stored) => stored === null;
    const outcomes = await Promise.all([
      putIf(tenantId, create, 'a'),
      putIf(tenantId, create, 'b'),
      putIf(tenantId, create, 'c'),
    ]);
    expect(outcomes.filter((outcome) => outcome === 'ok')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'precondition_failed')).toHaveLength(2);
  });

  it('cannot see another tenant’s row, so a replace there finds nothing', async () => {
    const mine = await newTenant();
    const theirs = await newTenant();
    await put(theirs, 'fr', 'login.title', 'theirs');
    const seen: (string | null)[] = [];
    await withTenant(app.db, mine, (tx) =>
      repo(tx).put({ tenantId: theirs, locale: 'fr', key: 'login.title', message: 'x' }, (row) => {
        seen.push(row?.message ?? null);
        return true;
      }),
    ).catch(() => undefined);
    expect(seen).toEqual([null]);
    const held = await withTenant(app.db, theirs, (tx) => repo(tx).forRender(theirs, 'fr'));
    expect(held).toEqual({ 'login.title': 'theirs' });
  });
});

describe('another tenant', () => {
  it('cannot see a row through the table', async () => {
    await expectTenantIsolation(app.db, {
      table: 'message_overrides',
      seed: async (tx, tenantId) => {
        await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
        await repo(tx).put({ tenantId, locale: 'fr', key: 'login.title', message: 'x' });
      },
    });
  });

  const seedOne = async (tx: TenantScopedDatabase, tenantId: string) => {
    await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
    await repo(tx).put({ tenantId, locale: 'fr', key: 'login.title', message: 'x' });
    return tenantId;
  };
  const stillThere = async (tx: TenantScopedDatabase, tenantId: string) => {
    expect(await repo(tx).forRender(tenantId, 'fr')).toEqual({ 'login.title': 'x' });
  };

  it('reads nothing of it, by list or by render', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedOne,
      verifySeeded: stillThere,
      attempt: async (tx, tenantId) => ({
        listed: await repo(tx).list(tenantId, 'fr', { limit: 10 }),
        rendered: await repo(tx).forRender(tenantId, 'fr'),
        one: await repo(tx).get(tenantId, 'fr', 'login.title'),
      }),
      expectBlocked: (result) => {
        expect(result).toEqual({ listed: [], rendered: {}, one: null });
      },
    });
  });

  it('cannot delete it', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedOne,
      verifySeeded: stillThere,
      attempt: (tx, tenantId) => repo(tx).delete(tenantId, 'fr', 'login.title', () => true),
      expectBlocked: (result) => {
        expect(result).toBe('not_found');
      },
      verifyTenantAUnaffected: stillThere,
    });
  });

  it('cannot write into it, even given its tenant id', async () => {
    const tenantA = newId();
    await withTenant(app.db, tenantA, (tx) => seedOne(tx, tenantA));
    const tenantB = await newTenant();
    const refused = await withTenant(app.db, tenantB, (tx) =>
      repo(tx).put({ tenantId: tenantA, locale: 'fr', key: 'login.title', message: 'taken' }),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(Error);
    expect(refused instanceof Error && String(refused.cause)).toMatch(/row-level security/);
    await withTenant(app.db, tenantA, (tx) => stillThere(tx, tenantA));
  });
});
