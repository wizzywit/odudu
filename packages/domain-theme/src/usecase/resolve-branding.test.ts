import { type PageBranding, type TemplateFallback } from '@odudu/kernel';
import { describe, expect, it, vi } from 'vitest';
import { type PublishedAsset, type PublishedLayer, type PublishedLayers } from '#/service/record';
import { type Palette, type ThemeBody } from '#/service/body';
import { brandingCache, createBrandingCache } from '#/service/branding-cache';
import {
  MAX_BRANDING_BACKOFFS,
  MAX_BRANDING_READS_IN_FLIGHT,
  MAX_LOGGED_BRANDING_PROBLEMS,
  resolveBranding,
  type BrandingProblem,
  type ResolveBrandingDeps,
} from '#/usecase/resolve-branding';

const ORIGIN = 'https://id.example.test';
const TENANT = { tenantId: 't1', tenantName: 'acme' };
const SIGN_IN = '<div>{{intro}}{{form.open}}{{fields}}{{submit}}{{error}}{{form.close}}</div>';
const ASSET_ID = '00000000-0000-4000-8000-0000000000a1';
const OTHER_ASSET_ID = '00000000-0000-4000-8000-0000000000a2';
const SHA = 'ab'.repeat(32);

const PALETTE: Palette = {
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

function body(parts: Partial<ThemeBody> = {}): ThemeBody {
  return { tokens: {}, stylesheet: null, templates: {}, assets: {}, ...parts };
}

function layer(themeBody: unknown, version = 1, assets: PublishedAsset[] = []): PublishedLayer {
  return { versionId: `v${String(version)}`, clientId: null, version, body: themeBody, assets };
}

function world(layers: PublishedLayers = { tenant: null, client: null }) {
  const reads: [string, string | null][] = [];
  const problems: BrandingProblem[] = [];
  const fallbacks: TemplateFallback[] = [];
  const clock = { now: 0 };
  const cache = createBrandingCache<PageBranding | null>({ now: () => clock.now });
  const state = { layers, fail: false, origin: ORIGIN as string | undefined };
  const deps = (): ResolveBrandingDeps => ({
    readPublished: (tenantId, clientId) => {
      reads.push([tenantId, clientId]);
      if (state.fail) return Promise.reject(new Error('connection refused'));
      return Promise.resolve(state.layers);
    },
    origin: state.origin,
    now: () => clock.now,
    cache,
    log: (problem) => problems.push(problem),
    reportFallback: (entry) => fallbacks.push(entry),
  });
  return {
    reads,
    problems,
    fallbacks,
    clock,
    cache,
    state,
    resolver: () => resolveBranding(deps()),
  };
}

describe('resolveBranding', () => {
  it('returns null for a tenant with no theme and keeps that answer', async () => {
    const w = world();
    const resolve = w.resolver();
    expect(await resolve({ ...TENANT, clientId: null })).toBeNull();
    expect(await resolve({ ...TENANT, clientId: null })).toBeNull();
    expect(w.reads).toHaveLength(1);
  });

  it('resolves a published tenant theme into urls under the configured origin', async () => {
    const w = world({
      tenant: layer(
        body({
          tokens: { light: PALETTE },
          templates: { 'sign-in': SIGN_IN },
          assets: { logo: { assetId: ASSET_ID, alt: 'Acme' } },
        }),
        3,
        [{ id: ASSET_ID, sha256: SHA, mime: 'image/png', width: 300, height: 100 }],
      ),
      client: null,
    });
    const found = await w.resolver()({ ...TENANT, clientId: null });
    expect(found?.branding.origin).toBe(ORIGIN);
    expect(found?.branding.templates['sign-in']).toBe(SIGN_IN);
    expect(found?.branding.logo).toEqual({
      url: `/tenants/acme/brand/${SHA}.png`,
      darkUrl: null,
      alt: 'Acme',
    });
    expect(found?.branding.assetUrls).toEqual([`/tenants/acme/brand/${SHA}.png`]);
    expect(found?.branding.stylesheetUrl).toMatch(/^\/tenants\/acme\/brand\/[0-9a-f]{64}\.css$/u);
    expect(found?.branding.tokensCss).toContain('--surface-page:#ffffff;');
    expect(w.problems).toEqual([]);
  });

  it('treats a published theme that sets nothing as the default look', async () => {
    const w = world({ tenant: layer(body(), 3), client: layer(body(), 2) });
    expect(await w.resolver()({ ...TENANT, clientId: 'web' })).toBeNull();
    expect(w.problems).toEqual([]);
  });

  it('falls back to the tenant when the client has no theme', async () => {
    const w = world({ tenant: layer(body({ templates: { 'sign-in': SIGN_IN } })), client: null });
    const found = await w.resolver()({ ...TENANT, clientId: 'web' });
    expect(found?.branding.templates['sign-in']).toBe(SIGN_IN);
    expect(w.reads).toEqual([['t1', 'web']]);
  });

  it("takes each piece from the client's layer when it has one, else the tenant's", async () => {
    const w = world({
      tenant: layer(body({ tokens: { light: PALETTE }, templates: { 'sign-in': SIGN_IN } })),
      client: layer(body({ templates: { notice: '<p>{{message}}</p>' } }), 2),
    });
    const found = await w.resolver()({ ...TENANT, clientId: 'web' });
    expect(Object.keys(found?.branding.templates ?? {}).sort()).toEqual(['notice', 'sign-in']);
    expect(found?.branding.tokensCss).toContain('--surface-page');
  });

  it('falls back to default and logs when a referenced asset is gone', async () => {
    const w = world({
      tenant: layer(body({ assets: { logo: { assetId: ASSET_ID, alt: 'Acme' } } }), 4, []),
      client: null,
    });
    expect(await w.resolver()({ ...TENANT, clientId: null })).toBeNull();
    expect(w.problems).toHaveLength(1);
    expect(w.problems[0]?.reason).toMatch(/image that is gone/u);
    expect(w.problems[0]?.scope).toBe('t1::4.0');
  });

  it("falls back to the tenant's theme when the client's names a gone image", async () => {
    const w = world({
      tenant: layer(body({ templates: { 'sign-in': SIGN_IN } })),
      client: layer(body({ assets: { logo: { assetId: ASSET_ID, alt: 'x' } } }), 2),
    });
    const found = await w.resolver()({ ...TENANT, clientId: 'web' });
    expect(found?.branding.logo).toBeNull();
    expect(found?.branding.templates['sign-in']).toBe(SIGN_IN);
    expect(w.problems).toHaveLength(1);
  });

  it('falls back when a stored template fails the current check, and reports it once', async () => {
    const w = world({
      tenant: layer(
        body({ templates: { verification: '<p>{{message}}</p>', 'sign-in': SIGN_IN } }),
      ),
      client: null,
    });
    const resolve = w.resolver();
    const found = await resolve({ ...TENANT, clientId: null });
    expect(found?.branding.templates.verification).toBeUndefined();
    expect(found?.branding.templates['sign-in']).toBe(SIGN_IN);
    expect(w.fallbacks).toHaveLength(1);
    expect(w.fallbacks[0]).toMatchObject({ kind: 'verification', scope: 't1::1.0' });
    expect(w.fallbacks[0]?.reason).toContain('missing-part');
    await resolve({ ...TENANT, clientId: null });
    w.cache.invalidateTenant('t1');
    await resolve({ ...TENANT, clientId: null });
    expect(w.fallbacks).toHaveLength(1);
  });

  it("falls to the tenant's template when the client's fails its check", async () => {
    const w = world({
      tenant: layer(body({ templates: { 'sign-in': SIGN_IN } })),
      client: layer(body({ templates: { 'sign-in': '<p>no form</p>' } }), 2),
    });
    const found = await w.resolver()({ ...TENANT, clientId: 'web' });
    expect(found?.branding.templates['sign-in']).toBe(SIGN_IN);
    expect(w.fallbacks[0]).toMatchObject({ scope: 't1:web:1.2' });
  });

  it('a draft that was never published is not here to render', async () => {
    const w = world();
    expect(await w.resolver()({ ...TENANT, clientId: null })).toBeNull();
  });

  it('a render makes at most 1 theme query on a cache miss and 0 on a hit', async () => {
    const w = world({ tenant: layer(body({ templates: { 'sign-in': SIGN_IN } })), client: null });
    const resolve = w.resolver();
    await resolve({ ...TENANT, clientId: 'web' });
    expect(w.reads).toHaveLength(1);
    await resolve({ ...TENANT, clientId: 'web' });
    await resolve({ ...TENANT, clientId: 'web' });
    expect(w.reads).toHaveLength(1);
    await resolve({ ...TENANT, clientId: null });
    expect(w.reads).toHaveLength(2);
  });

  it('reads again after the ttl', async () => {
    const w = world();
    const resolve = w.resolver();
    await resolve({ ...TENANT, clientId: null });
    w.clock.now = brandingCache.ttlMs;
    await resolve({ ...TENANT, clientId: null });
    expect(w.reads).toHaveLength(2);
  });

  it('publishing invalidates the entry', async () => {
    const w = world();
    const resolve = w.resolver();
    expect(await resolve({ ...TENANT, clientId: null })).toBeNull();
    w.state.layers = {
      tenant: layer(body({ templates: { 'sign-in': SIGN_IN } }), 2),
      client: null,
    };
    expect(await resolve({ ...TENANT, clientId: null })).toBeNull();
    w.cache.invalidateTenant('t1');
    const found = await resolve({ ...TENANT, clientId: null });
    expect(found?.branding.templates['sign-in']).toBe(SIGN_IN);
  });

  it('does not cache a read begun before an invalidation', async () => {
    const w = world({ tenant: layer(body({ templates: { 'sign-in': SIGN_IN } })), client: null });
    const resolve = w.resolver();
    const pending = resolve({ ...TENANT, clientId: null });
    w.cache.invalidateTenant('t1');
    await pending;
    await resolve({ ...TENANT, clientId: null });
    expect(w.reads).toHaveLength(2);
  });

  it('concurrent misses for one key share one read', async () => {
    const w = world();
    const resolve = w.resolver();
    await Promise.all(Array.from({ length: 50 }, () => resolve({ ...TENANT, clientId: 'web' })));
    expect(w.reads).toHaveLength(1);
  });

  it('bounds the reads in flight at once', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = vi.fn();
    const cache = createBrandingCache<PageBranding | null>({ now: () => 0 });
    const resolve = resolveBranding({
      readPublished: async () => {
        started();
        await gate;
        return { tenant: null, client: null };
      },
      origin: ORIGIN,
      now: () => 0,
      cache,
      log: () => undefined,
      reportFallback: () => undefined,
    });
    const keys = MAX_BRANDING_READS_IN_FLIGHT + 40;
    const all = Promise.all(
      Array.from({ length: keys }, (_, i) => resolve({ ...TENANT, clientId: `c${String(i)}` })),
    );
    await Promise.resolve();
    expect(started).toHaveBeenCalledTimes(keys);
    release();
    await all;
    expect(cache.size()).toBe(keys);
  });

  it('never throws into a render when the database fails, and logs once', async () => {
    const w = world();
    w.state.fail = true;
    const resolve = w.resolver();
    const results = await Promise.all(
      Array.from({ length: 100 }, () => resolve({ ...TENANT, clientId: null })),
    );
    expect(results.every((result) => result === null)).toBe(true);
    for (let i = 0; i < 100; i += 1) await resolve({ ...TENANT, clientId: null });
    expect(w.reads).toHaveLength(1);
    expect(w.problems).toHaveLength(1);
    expect(w.problems[0]?.reason).toContain('connection refused');
  });

  it('retries a failed read after the backoff, and logs a repeat of it once', async () => {
    const w = world();
    w.state.fail = true;
    const resolve = w.resolver();
    await resolve({ ...TENANT, clientId: null });
    w.clock.now = 999;
    await resolve({ ...TENANT, clientId: null });
    expect(w.reads).toHaveLength(1);
    w.clock.now = 1000;
    await resolve({ ...TENANT, clientId: null });
    expect(w.reads).toHaveLength(2);
    expect(w.problems).toHaveLength(1);
    w.state.fail = false;
    w.clock.now = 2000;
    expect(await resolve({ ...TENANT, clientId: null })).toBeNull();
    expect(w.reads).toHaveLength(3);
    expect(w.problems).toHaveLength(1);
  });

  it('bounds the keys it holds in backoff by emptying the set when full', async () => {
    const w = world();
    w.state.fail = true;
    const resolve = w.resolver();
    const total = MAX_BRANDING_BACKOFFS + 5;
    for (let i = 0; i < total; i += 1) {
      await resolve({ ...TENANT, clientId: `c${String(i)}` });
    }
    expect(w.reads).toHaveLength(total);
    // The oldest key was forgotten when the set filled, so it retries at once;
    // the newest is still backing off.
    await resolve({ ...TENANT, clientId: 'c0' });
    expect(w.reads).toHaveLength(total + 1);
    await resolve({ ...TENANT, clientId: `c${String(total - 1)}` });
    expect(w.reads).toHaveLength(total + 1);
  });

  it('a publish within the backoff does not leave the tenant on the default', async () => {
    const w = world();
    w.state.fail = true;
    const resolve = w.resolver();
    await resolve({ ...TENANT, clientId: null });
    w.state.fail = false;
    w.state.layers = {
      tenant: layer(body({ templates: { 'sign-in': SIGN_IN } }), 2),
      client: null,
    };
    w.clock.now = 100;
    expect(await resolve({ ...TENANT, clientId: null })).toBeNull();
    w.cache.invalidateTenant('t1');
    const found = await resolve({ ...TENANT, clientId: null });
    expect(found?.branding.templates['sign-in']).toBe(SIGN_IN);
  });

  it('a read that began before an invalidation sets no backoff for the new generation', async () => {
    const releases: (() => void)[] = [];
    const cache = createBrandingCache<PageBranding | null>({ now: () => 0 });
    let reads = 0;
    const resolve = resolveBranding({
      readPublished: async () => {
        reads += 1;
        if (reads === 1) {
          await new Promise<void>((release) => releases.push(release));
          throw new Error('connection refused');
        }
        return { tenant: layer(body({ templates: { 'sign-in': SIGN_IN } }), 2), client: null };
      },
      origin: ORIGIN,
      now: () => 0,
      cache,
      log: () => undefined,
      reportFallback: () => undefined,
    });
    const failing = resolve({ ...TENANT, clientId: null });
    cache.invalidateTenant('t1');
    for (const release of releases) release();
    expect(await failing).toBeNull();
    const found = await resolve({ ...TENANT, clientId: null });
    expect(found?.branding.templates['sign-in']).toBe(SIGN_IN);
  });

  it('a request after an invalidation does not join the read begun before it', async () => {
    const releases: (() => void)[] = [];
    const cache = createBrandingCache<PageBranding | null>({ now: () => 0 });
    let published = false;
    const resolve = resolveBranding({
      readPublished: async () => {
        const answer = {
          tenant: published ? layer(body({ templates: { 'sign-in': SIGN_IN } }), 2) : null,
          client: null,
        };
        await new Promise<void>((release) => releases.push(release));
        return answer;
      },
      origin: ORIGIN,
      now: () => 0,
      cache,
      log: () => undefined,
      reportFallback: () => undefined,
    });
    const before = resolve({ ...TENANT, clientId: null });
    published = true;
    cache.invalidateTenant('t1');
    const after = resolve({ ...TENANT, clientId: null });
    expect(releases).toHaveLength(2);
    for (const release of releases) release();
    expect(await before).toBeNull();
    expect((await after)?.branding.templates['sign-in']).toBe(SIGN_IN);
    expect((await resolve({ ...TENANT, clientId: null }))?.branding.templates['sign-in']).toBe(
      SIGN_IN,
    );
  });

  it("one tenant's invalidation leaves another tenant's read cacheable", async () => {
    const w = world();
    const resolve = w.resolver();
    const pending = resolve({ tenantId: 't2', tenantName: 'rival', clientId: null });
    w.cache.invalidateTenant('t1');
    await pending;
    await resolve({ tenantId: 't2', tenantName: 'rival', clientId: null });
    expect(w.reads).toHaveLength(1);
  });

  it('does not throw when the stored body is not even an object', async () => {
    for (const stored of [null, 'text', 7, [], { tokens: 'x' }]) {
      const w = world({ tenant: layer(stored), client: null });
      expect(await w.resolver()({ ...TENANT, clientId: null })).toBeNull();
      expect(w.problems[0]?.reason).toMatch(/not a valid body/u);
    }
  });

  it.each([
    ['an oversized template', body({ templates: { 'sign-in': 'a'.repeat(70_000) } })],
    ['an invalid colour', { ...body(), tokens: { light: { ...PALETTE, inkPrimary: 'red' } } }],
    ['an unknown key', { ...body(), extra: true }],
    ['an unknown page kind', { ...body(), templates: { nonsense: '<p></p>' } }],
  ])('never lets %s reach a page', async (_name, hostile) => {
    const w = world({ tenant: layer(hostile), client: null });
    expect(await w.resolver()({ ...TENANT, clientId: null })).toBeNull();
    expect(w.problems).toHaveLength(1);
  });

  it('refuses an image of a type no upload produces', async () => {
    const w = world({
      tenant: layer(body({ assets: { logo: { assetId: ASSET_ID, alt: 'x' } } }), 1, [
        { id: ASSET_ID, sha256: SHA, mime: 'image/svg+xml', width: 300, height: 100 },
      ]),
      client: null,
    });
    expect(await w.resolver()({ ...TENANT, clientId: null })).toBeNull();
  });

  it('does not use an image the version does not name', async () => {
    const w = world({
      tenant: layer(body({ assets: { logo: { assetId: ASSET_ID, alt: 'x' } } }), 1, [
        { id: OTHER_ASSET_ID, sha256: SHA, mime: 'image/png', width: 300, height: 100 },
      ]),
      client: null,
    });
    expect(await w.resolver()({ ...TENANT, clientId: null })).toBeNull();
  });

  it('drops a stylesheet that fails the check and keeps the rest', async () => {
    const w = world({
      tenant: layer(
        body({
          stylesheet: '@import url(https://evil.example/x.css);',
          templates: { 'sign-in': SIGN_IN },
        }),
      ),
      client: null,
    });
    const found = await w.resolver()({ ...TENANT, clientId: null });
    expect(found?.branding.stylesheetUrl).toBeNull();
    expect(found?.branding.templates['sign-in']).toBe(SIGN_IN);
    expect(w.problems[0]?.reason).toMatch(/stylesheet/u);
  });

  it('falls back when a tenant name would make an unusable url', async () => {
    const w = world({
      tenant: layer(body({ stylesheet: '.logo{display:none}' })),
      client: null,
    });
    const found = await w.resolver()({ tenantId: 't1', tenantName: 'a/../b', clientId: null });
    expect(found).toBeNull();
    expect(w.problems[0]?.reason).toMatch(/stylesheetUrl/u);
  });

  it('is unthemed, and says so once, when no public base url is configured', async () => {
    const w = world({ tenant: layer(body({ templates: { 'sign-in': SIGN_IN } })), client: null });
    w.state.origin = undefined;
    const resolve = w.resolver();
    expect(await resolve({ ...TENANT, clientId: null })).toBeNull();
    expect(await resolve({ ...TENANT, clientId: null })).toBeNull();
    expect(w.reads).toHaveLength(0);
    expect(w.problems).toHaveLength(1);
  });

  it('treats an empty or oversized client id as no client, and shares the tenant entry', async () => {
    const w = world();
    const resolve = w.resolver();
    await resolve({ ...TENANT, clientId: null });
    await resolve({ ...TENANT, clientId: '' });
    await resolve({ ...TENANT, clientId: 'x'.repeat(300) });
    expect(w.reads).toEqual([['t1', null]]);
  });

  it('a garbage client_id yields the tenant theme', async () => {
    const w = world({ tenant: layer(body({ templates: { 'sign-in': SIGN_IN } })), client: null });
    const found = await w.resolver()({ ...TENANT, clientId: "'; drop table clients; --" });
    expect(found?.branding.templates['sign-in']).toBe(SIGN_IN);
  });

  it('bounds what it remembers having logged', async () => {
    const w = world({ tenant: layer('bad'), client: null });
    const resolve = w.resolver();
    for (let i = 0; i < MAX_LOGGED_BRANDING_PROBLEMS + 10; i += 1) {
      await resolve({ tenantId: `t${String(i)}`, tenantName: 'acme', clientId: null });
    }
    expect(w.problems).toHaveLength(MAX_LOGGED_BRANDING_PROBLEMS + 10);
    expect(w.cache.size()).toBeLessThanOrEqual(brandingCache.maxEntries);
  });
});
