import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { type MailBranding, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mailContext, tenantMailContext, type MailBrandingResolver } from '#/usecase/mail-context';

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

const BRANDING: MailBranding = { palette: null, darkPalette: null, logo: null, darkLogo: null };

async function tenant(defaultLocale: string | null): Promise<{ id: string; name: string }> {
  const id = newId();
  const name = `ctx-${id}`;
  await owner.db.insert(tenants).values({ id, name });
  if (defaultLocale !== null) {
    await owner.db
      .update(tenants)
      .set({ supportedLocales: ['en', defaultLocale], defaultLocale })
      .where(eq(tenants.id, id));
  }
  return { id, name };
}

describe('mailContext', () => {
  it("reads the tenant's default language and its theme in the one transaction", async () => {
    const t = await tenant('fr');
    const asked: unknown[] = [];
    const resolve: MailBrandingResolver = (_tx, scope) => {
      asked.push(scope);
      return Promise.resolve({ branding: BRANDING, overrides: { fr: { 'reset.button': 'Go' } } });
    };
    const context = await withTenant(app.db, t.id, (tx) =>
      mailContext(tx, resolve, { tenantId: t.id, tenantName: t.name }),
    );
    expect(context).toEqual({
      branding: BRANDING,
      overrides: { fr: { 'reset.button': 'Go' } },
      tenantDefaultLocale: 'fr',
    });
    expect(asked).toEqual([{ tenantId: t.id, tenantName: t.name }]);
  });

  it('is unthemed and without a default language where the tenant sets none', async () => {
    const t = await tenant(null);
    const context = await withTenant(app.db, t.id, (tx) =>
      mailContext(tx, undefined, { tenantId: t.id, tenantName: t.name }),
    );
    expect(context).toEqual({ branding: null, overrides: {}, tenantDefaultLocale: null });
  });

  it("does not read another tenant's default language from this tenant's transaction", async () => {
    const mine = await tenant(null);
    const foreign = await tenant('fr');
    const context = await withTenant(app.db, mine.id, (tx) =>
      mailContext(tx, undefined, { tenantId: foreign.id, tenantName: foreign.name }),
    );
    expect(context.tenantDefaultLocale).toBeNull();
  });

  it('is unthemed, and still reads the language, when the resolver rejects', async () => {
    const t = await tenant('fr');
    const resolve: MailBrandingResolver = () => Promise.reject(new Error('theme store down'));
    const context = await withTenant(app.db, t.id, (tx) =>
      mailContext(tx, resolve, { tenantId: t.id, tenantName: t.name }),
    );
    expect(context).toEqual({ branding: null, overrides: {}, tenantDefaultLocale: 'fr' });
  });
});

describe('tenantMailContext', () => {
  it('adds the tenant’s display name to what mailContext reads, in one tenant statement', async () => {
    const t = await tenant('fr');
    await owner.db.update(tenants).set({ displayName: 'Acme Ltd' }).where(eq(tenants.id, t.id));
    const context = await withTenant(app.db, t.id, (tx) =>
      tenantMailContext(tx, undefined, { tenantId: t.id, tenantName: t.name }),
    );
    expect(context).toEqual({
      branding: null,
      overrides: {},
      tenantDefaultLocale: 'fr',
      displayName: 'Acme Ltd',
    });
  });

  it('has no display name for a tenant that sets none', async () => {
    const t = await tenant(null);
    const context = await withTenant(app.db, t.id, (tx) =>
      tenantMailContext(tx, undefined, { tenantId: t.id, tenantName: t.name }),
    );
    expect(context.displayName).toBeNull();
  });
});
