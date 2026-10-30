import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { clients } from '@odudu/domain-tenant';
import { newId, type PageBranding, type TemplateFallback } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assetRepository } from '#/repository/assets';
import { publishedThemeRepository } from '#/repository/published-themes';
import { themeRepository } from '#/repository/themes';
import { themeAssets } from '#/schema/theme-assets';
import { type ThemeBody } from '#/service/body';
import { createBrandingCache } from '#/service/branding-cache';
import { type ThemeScope } from '#/service/record';
import { resolveBranding, type BrandingProblem } from '#/usecase/resolve-branding';
import { eq } from 'drizzle-orm';

const ORIGIN = 'https://id.example.test';
const SIGN_IN = '<div>{{intro}}{{form.open}}{{fields}}{{submit}}{{error}}{{form.close}}</div>';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(containerHandle.adminUrl), { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

function body(parts: Partial<ThemeBody> = {}): ThemeBody {
  return { tokens: {}, stylesheet: null, templates: {}, assets: {}, ...parts };
}

async function seedTenant(): Promise<{ tenantId: string; tenantName: string }> {
  const tenantId = newId();
  const tenantName = `tenant-${tenantId}`;
  await withTenant(app.db, tenantId, (tx) =>
    tx.insert(tenants).values({ id: tenantId, name: tenantName }),
  );
  return { tenantId, tenantName };
}

async function seedClient(tenantId: string): Promise<{ id: string; oauthId: string }> {
  const id = newId();
  const oauthId = `client-${id}`;
  await withTenant(app.db, tenantId, (tx: TenantScopedDatabase) =>
    tx.insert(clients).values({
      id,
      tenantId,
      clientId: oauthId,
      name: 'A client',
      type: 'public',
      secretHash: null,
    }),
  );
  return { id, oauthId };
}

async function publish(scope: ThemeScope, themeBody: ThemeBody): Promise<void> {
  await withTenant(app.db, scope.tenantId, async (tx) => {
    const themes = themeRepository(tx);
    await themes.saveDraft(scope, themeBody, (await themes.draft(scope))?.etag ?? null);
    await themes.publish(scope);
  });
}

async function storeAsset(tenantId: string, label: string, mime = 'image/png') {
  const stored = await withTenant(app.db, tenantId, (tx) =>
    assetRepository(tx).put({
      tenantId,
      sha256: label.padEnd(64, '0'),
      mime,
      width: 4,
      height: 3,
      bytes: Buffer.from(label),
      tenantCapBytes: 4096,
    }),
  );
  if (stored === 'over_cap') throw new Error('asset refused');
  return stored;
}

function resolver() {
  const problems: BrandingProblem[] = [];
  const fallbacks: TemplateFallback[] = [];
  let reads = 0;
  const cache = createBrandingCache<PageBranding | null>({ now: () => Date.now() });
  const resolve = resolveBranding({
    readPublished: (tenantId, clientId) => {
      reads += 1;
      return withTenant(app.db, tenantId, (tx) =>
        publishedThemeRepository(tx).forRender(tenantId, clientId),
      );
    },
    origin: ORIGIN,
    now: () => Date.now(),
    cache,
    log: (problem) => problems.push(problem),
    reportFallback: (entry) => fallbacks.push(entry),
  });
  return { resolve, problems, fallbacks, cache, reads: () => reads };
}

describe('resolveBranding against PostgreSQL', () => {
  it('layers the client over the tenant with one read', async () => {
    const { tenantId, tenantName } = await seedTenant();
    const client = await seedClient(tenantId);
    const logo = await storeAsset(tenantId, 'logo');
    await publish(
      { tenantId, clientId: null },
      body({
        templates: { 'sign-in': SIGN_IN },
        assets: { logo: { assetId: logo.id, alt: 'Tenant' } },
      }),
    );
    await publish(
      { tenantId, clientId: client.id },
      body({ templates: { notice: '<p>{{message}}</p>' } }),
    );
    const r = resolver();
    const found = await r.resolve({ tenantId, tenantName, clientId: client.oauthId });
    expect(found?.branding.templates['sign-in']).toBe(SIGN_IN);
    expect(found?.branding.templates.notice).toBe('<p>{{message}}</p>');
    expect(found?.branding.logo?.url).toBe(`/tenants/${tenantName}/brand/${logo.sha256}.png`);
    expect(r.reads()).toBe(1);
    await r.resolve({ tenantId, tenantName, clientId: client.oauthId });
    expect(r.reads()).toBe(1);
  });

  it("return_to naming another tenant's client yields the tenant theme", async () => {
    const a = await seedTenant();
    const b = await seedTenant();
    const foreign = await seedClient(b.tenantId);
    await publish(
      { tenantId: a.tenantId, clientId: null },
      body({ templates: { 'sign-in': SIGN_IN } }),
    );
    await publish(
      { tenantId: b.tenantId, clientId: foreign.id },
      body({ templates: { notice: '<p>{{message}}</p>' } }),
    );
    const found = await resolver().resolve({
      tenantId: a.tenantId,
      tenantName: a.tenantName,
      clientId: foreign.oauthId,
    });
    expect(Object.keys(found?.branding.templates ?? {})).toEqual(['sign-in']);
  });

  it('a garbage client_id yields the tenant theme', async () => {
    const a = await seedTenant();
    await publish(
      { tenantId: a.tenantId, clientId: null },
      body({ templates: { 'sign-in': SIGN_IN } }),
    );
    for (const clientId of ["x'--", '%00', 'ünï', '../../etc']) {
      const found = await resolver().resolve({ ...a, clientId });
      expect(Object.keys(found?.branding.templates ?? {})).toEqual(['sign-in']);
    }
  });

  it('never renders a draft, and answers the default for a tenant with none published', async () => {
    const a = await seedTenant();
    await withTenant(app.db, a.tenantId, (tx) =>
      themeRepository(tx).saveDraft(
        { tenantId: a.tenantId, clientId: null },
        body({ templates: { 'sign-in': SIGN_IN } }),
        null,
      ),
    );
    expect(await resolver().resolve({ ...a, clientId: null })).toBeNull();
  });

  it('falls back to default when the image a published version names is deleted', async () => {
    const a = await seedTenant();
    const logo = await storeAsset(a.tenantId, 'doomed');
    await publish(
      { tenantId: a.tenantId, clientId: null },
      body({ assets: { logo: { assetId: logo.id, alt: 'x' } } }),
    );
    await owner.db.delete(themeAssets).where(eq(themeAssets.id, logo.id));
    const r = resolver();
    expect(await r.resolve({ ...a, clientId: null })).toBeNull();
    expect(r.problems).toHaveLength(1);
  });

  it("never uses another tenant's image, even one a row of this tenant points at", async () => {
    const a = await seedTenant();
    const b = await seedTenant();
    const theirs = await storeAsset(b.tenantId, 'theirs');
    await publish(
      { tenantId: a.tenantId, clientId: null },
      body({ assets: { logo: { assetId: theirs.id, alt: 'x' } } }),
    );
    const r = resolver();
    expect(await r.resolve({ ...a, clientId: null })).toBeNull();
    expect(r.problems[0]?.reason).toMatch(/image that is gone/u);
  });

  it('refuses a stored SVG image', async () => {
    const a = await seedTenant();
    const svg = await storeAsset(a.tenantId, 'vector', 'image/svg+xml');
    await publish(
      { tenantId: a.tenantId, clientId: null },
      body({ assets: { logo: { assetId: svg.id, alt: 'x' } } }),
    );
    expect(await resolver().resolve({ ...a, clientId: null })).toBeNull();
  });

  it('never reads a hostile row into a page', async () => {
    const a = await seedTenant();
    await publish(
      { tenantId: a.tenantId, clientId: null },
      body({ templates: { 'sign-in': SIGN_IN } }),
    );
    await owner.sql`update theme_versions set body = '{"templates":{"sign-in":"<script>alert(1)</script>"},"tokens":{"light":{"inkPrimary":"url(x)"}}}'::jsonb where tenant_id = ${a.tenantId}`;
    const r = resolver();
    expect(await r.resolve({ ...a, clientId: null })).toBeNull();
    expect(r.problems).toHaveLength(1);
  });
});
