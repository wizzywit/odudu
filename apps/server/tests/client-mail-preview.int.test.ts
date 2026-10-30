import { createDatabase, MIGRATIONS_DIR, runMigrations, tenants, withTenant } from '@odudu/db';
import { type DatabaseHandle } from '@odudu/db';
import { clients } from '@odudu/domain-tenant';
import { assetRepository, themeRepository, type ThemeBody } from '@odudu/domain-theme';
import { newId } from '@odudu/kernel';
import { createAppRole, makePng, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { and, eq } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { mintAdminToken } from '#/testing/plan-admin-drives';
import { createBranding, type Branding } from '#/branding';
import { seed } from '#/cli/seed';
import { isWork, StatementRecorder } from '#/testing/plan-capture';

// The mail a client's sign-in would send, previewed: the client's published
// layer over the tenant's, the tenant's look for a client that is disabled,
// and the same 404 for a client the tenant does not hold.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;
let branding: Branding;
const recorder = new StatementRecorder();

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.test';
const EMAIL = 'ada@example.test';
const TENANT_CAP = 8 * 1024 * 1024;
const LIGHT = {
  surfacePage: '#ffffff',
  surfacePanel: '#fafafa',
  surfaceSunken: '#f0f0f0',
  inkPrimary: '#111111',
  inkMuted: '#555555',
  signalActive: '#ddeedd',
  signalActiveInk: '#004400',
  signalDanger: '#fde0d0',
  signalDangerInk: '#802000',
  borderStrong: '#777777',
  focusRing: '#0044aa',
};
const WARM = { ...LIGHT, surfacePanel: '#fffaf0' };
const COOL = { ...LIGHT, surfacePanel: '#e0f0ff' };

// The caller's checks, the client's row, the tenant's row, the client-bound
// theme read in a savepoint and one more read: the overrides for the preview,
// the tenant's own look for the branding view.
const STATEMENTS = 12;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 5, onQueryForTests: recorder.hook('app') });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  const logger = pino({ level: 'silent' });
  branding = createBranding({ database: appDb, logger, publicBaseUrl: BASE });
  app = buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger,
    tls: false,
    publicBaseUrl: BASE,
    deploymentSmtp: true,
    branding,
    throttle: { limit: 100_000, windowSeconds: 60 },
  });
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app.close();
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  await appDb.close();
  await owner.close();
  await container.stop();
});

interface World {
  name: string;
  tenantId: string;
  portalRowId: string;
}

async function world(): Promise<World> {
  const name = `cmp-${newId()}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: ['https://app.example/callback'],
    username: 'ada',
    password: 'correct horse battery staple',
    email: EMAIL,
  });
  await owner.db
    .update(tenants)
    .set({ resetPasswordAllowed: true })
    .where(eq(tenants.id, seeded.tenantId));
  const [portal] = await owner.db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.tenantId, seeded.tenantId), eq(clients.clientId, 'portal')));
  return { name, tenantId: seeded.tenantId, portalRowId: portal?.id ?? '' };
}

async function putLogo(w: World, size: { width: number; height: number }) {
  const bytes = makePng(size);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const stored = await withTenant(appDb.db, w.tenantId, (tx) =>
    assetRepository(tx).put({
      tenantId: w.tenantId,
      sha256,
      mime: 'image/png',
      ...size,
      bytes,
      tenantCapBytes: TENANT_CAP,
    }),
  );
  if (stored === 'over_cap') throw new Error('over cap');
  return { id: stored.id, url: `${BASE}/tenants/${w.name}/brand/${sha256}.png` };
}

async function publish(w: World, clientRowId: string | null, body: ThemeBody): Promise<void> {
  await withTenant(appDb.db, w.tenantId, async (tx) => {
    const themes = themeRepository(tx);
    const scope = { tenantId: w.tenantId, clientId: clientRowId };
    await themes.saveDraft(scope, body, (await themes.draft(scope))?.etag ?? null);
    await themes.publish(scope);
  });
  branding.invalidateTenant(w.tenantId);
}

function theme(parts: Partial<ThemeBody>): ThemeBody {
  return { tokens: {}, stylesheet: null, templates: {}, assets: {}, ...parts };
}

function token(w: World, capabilities: string[]): Promise<string> {
  return mintAdminToken({ http: app, app: appDb }, { id: w.tenantId, name: w.name }, capabilities);
}

async function get(w: World, path: string, capabilities: string[] = ['manage-clients']) {
  return app.inject({
    method: 'GET',
    url: `/admin/tenants/${w.name}${path}`,
    headers: { authorization: `Bearer ${await token(w, capabilities)}` },
  });
}

const preview = (w: World, id = w.portalRowId) => `/clients/${id}/mail/preview`;
const brandingOf = (w: World, id = w.portalRowId) => `/clients/${id}/mail/branding`;

interface BrandingBody {
  light: { source: string; colours: { panel: string } };
  dark: { source: string };
  logo: { alt: string } | null;
}

describe('the mail preview of a client', () => {
  it("is the client's colours and logo over the tenant's, and says which layer supplied each", async () => {
    const w = await world();
    const tenantLogo = await putLogo(w, { width: 100, height: 100 });
    const clientLogo = await putLogo(w, { width: 480, height: 96 });
    await publish(
      w,
      null,
      theme({
        tokens: { light: WARM },
        assets: { logo: { assetId: tenantLogo.id, alt: 'Tenant logo' } },
      }),
    );
    await publish(
      w,
      w.portalRowId,
      theme({
        tokens: { light: COOL },
        assets: { logo: { assetId: clientLogo.id, alt: 'Portal logo' } },
      }),
    );
    const shown = await get(w, preview(w));
    expect(shown.statusCode, shown.body).toBe(200);
    expect(shown.body).toContain('#e0f0ff');
    expect(shown.body).not.toContain('#fffaf0');
    expect(shown.body).toContain(clientLogo.url);
    const view = (await get(w, brandingOf(w))).json<BrandingBody>();
    expect(view.light).toMatchObject({ source: 'client', colours: { panel: '#e0f0ff' } });
    expect(view.dark.source).toBe('default');
    expect(view.logo?.alt).toBe('Portal logo');
  });

  it('reports the tenant as supplier for a client with no theme of its own', async () => {
    const w = await world();
    await publish(w, null, theme({ tokens: { light: WARM } }));
    expect((await get(w, brandingOf(w))).json<BrandingBody>().light.source).toBe('tenant');
    expect((await get(w, preview(w))).body).toContain('#fffaf0');
  });

  it("shows the tenant's look for a disabled client", async () => {
    const w = await world();
    await publish(w, null, theme({ tokens: { light: WARM } }));
    await publish(w, w.portalRowId, theme({ tokens: { light: COOL } }));
    await owner.db.update(clients).set({ enabled: false }).where(eq(clients.id, w.portalRowId));
    const shown = await get(w, preview(w));
    expect(shown.statusCode).toBe(200);
    expect(shown.body).toContain('#fffaf0');
    expect(shown.body).not.toContain('#e0f0ff');
    expect((await get(w, brandingOf(w))).json<BrandingBody>().light.source).toBe('tenant');
  });

  it('is the same 404, byte for byte, for a client of another tenant and one that is not there', async () => {
    const w = await world();
    const foreign = await world();
    for (const path of [preview, brandingOf]) {
      const missing = await get(w, path(w, newId()));
      const other = await get(w, path(w, foreign.portalRowId));
      expect(missing.statusCode).toBe(404);
      expect(other.statusCode).toBe(404);
      const bare = (body: string) => body.replace(/"instance":"[^"]*"/u, '');
      expect(bare(other.body)).toBe(bare(missing.body));
    }
  });

  it('needs manage-clients: manage-tenant alone is refused', async () => {
    const w = await world();
    for (const path of [preview(w), brandingOf(w)]) {
      expect((await get(w, path, ['manage-tenant'])).statusCode).toBe(403);
    }
  });
});

describe('what a client preview costs', () => {
  async function statementsFor(w: World, path: string): Promise<number> {
    branding.invalidateTenant(w.tenantId);
    const bearer = await token(w, ['manage-clients']);
    const { result, statements } = await recorder.record(() =>
      app.inject({
        method: 'GET',
        url: `/admin/tenants/${w.name}${path}`,
        headers: { authorization: `Bearer ${bearer}` },
      }),
    );
    expect(result.statusCode).toBe(200);
    return statements.filter((s) => isWork(s) || /^(savepoint|release)\b/iu.test(s.query.trim()))
      .length;
  }

  it('is the same few statements for a client naming two logos as for no theme', async () => {
    const bare = await world();
    const named = await world();
    const light = await putLogo(named, { width: 480, height: 96 });
    const dark = await putLogo(named, { width: 100, height: 100 });
    await publish(
      named,
      named.portalRowId,
      theme({
        tokens: { light: COOL },
        assets: { logo: { assetId: light.id, alt: 'A' }, darkLogo: { assetId: dark.id, alt: 'B' } },
      }),
    );
    for (const path of [preview, brandingOf]) {
      const none = await statementsFor(bare, path(bare));
      const two = await statementsFor(named, path(named));
      expect(two).toBe(none);
      expect(two).toBe(STATEMENTS);
    }
  });
});
