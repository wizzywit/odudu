import { describe, expect, it } from 'vitest';
import { type PublishedLayer, type PublishedLayers } from '#/service/record';
import { type ThemeBody } from '#/service/body';
import { assetPath, parseBrandFile, sha256Hex, stylesheetPath } from '#/service/branding-urls';
import { brandingCss, tokensCss } from '#/service/branding-css';
import { buildBranding } from '#/service/build-branding';
import {
  BRAND_MEMO,
  createBrandMemo,
  MAX_BRAND_BUILDS_IN_FLIGHT,
  serveBrand,
  type BrandAnswer,
  type ServeBrandDeps,
} from '#/usecase/serve-brand';

const ORIGIN = 'https://id.example.test';
const TENANT = { id: 't1', name: 'acme' };
const CLIENT_ROW = '00000000-0000-4000-8000-0000000000c1';
const PNG = Buffer.from('png-bytes');
const PNG_SHA = sha256Hex(PNG);

function body(stylesheet: string | null): ThemeBody {
  return { tokens: { font: 'IBM Plex Mono' }, stylesheet, templates: {}, assets: {} };
}

function layer(themeBody: ThemeBody, clientId: string | null, version = 1): PublishedLayer {
  return { versionId: `v${String(version)}`, clientId, version, body: themeBody, assets: [] };
}

function deps(state: {
  layers?: PublishedLayers;
  assets?: Record<string, { mime: string; bytes: Buffer }>;
  origin?: string | undefined;
  hold?: Promise<void>;
}): ServeBrandDeps & { reads: string[] } {
  const reads: string[] = [];
  // As the database answers: a client's layer only for a client segment.
  const resolve = (client: string | null): PublishedLayers => ({
    tenant: state.layers?.tenant ?? null,
    client: client === null ? null : (state.layers?.client ?? null),
  });
  return {
    reads,
    memo: createBrandMemo(() => 0),
    inflight: new Map(),
    readAssetMime: (tenantId, sha) => {
      reads.push(`mime:${tenantId}:${sha}`);
      return Promise.resolve(state.assets?.[sha]?.mime ?? null);
    },
    readIdentity: (tenantId, client) => {
      reads.push(`identity:${tenantId}:${client ?? ''}`);
      const layers = resolve(client);
      return Promise.resolve({
        tenant:
          layers.tenant === null
            ? null
            : { versionId: layers.tenant.versionId, version: layers.tenant.version },
        client:
          layers.client === null
            ? null
            : {
                versionId: layers.client.versionId,
                version: layers.client.version,
                clientId: client ?? '',
              },
      });
    },
    origin: 'origin' in state ? state.origin : ORIGIN,
    findTenant: (name) => {
      reads.push(`tenant:${name}`);
      return Promise.resolve(name === TENANT.name ? TENANT : null);
    },
    readAsset: (tenantId, sha) => {
      reads.push(`asset:${tenantId}:${sha}`);
      return Promise.resolve(state.assets?.[sha] ?? null);
    },
    readPublished: async (tenantId, client) => {
      reads.push(`layers:${tenantId}:${client ?? ''}`);
      await state.hold;
      return resolve(client);
    },
  };
}

function bytesOf(answer: BrandAnswer | null): Buffer {
  return answer?.kind === 'content' ? answer.bytes : Buffer.alloc(0);
}

function pageStylesheet(layers: PublishedLayers): string {
  const built = buildBranding({
    tenantName: TENANT.name,
    origin: ORIGIN,
    layers: [
      ...(layers.client === null ? [] : [{ name: 'client' as const, layer: layers.client }]),
      ...(layers.tenant === null ? [] : [{ name: 'tenant' as const, layer: layers.tenant }]),
    ],
  });
  return built.branding?.stylesheetUrl ?? '';
}

function requestFor(url: string): { tenant: string; client: string | null; file: string } {
  const segments = url.split('/');
  const file = segments[segments.length - 1] ?? '';
  const at = segments.indexOf('c');
  return { tenant: 'acme', client: at === -1 ? null : (segments[at + 1] ?? null), file };
}

describe('serveBrand images', () => {
  const assets = { [PNG_SHA]: { mime: 'image/png', bytes: PNG } };

  it('serves bytes under the stored mime with the hash as its etag', async () => {
    const answer = await serveBrand(deps({ assets }), {
      tenant: 'acme',
      client: null,
      file: `${PNG_SHA}.png`,
    });
    expect(answer).toEqual({
      kind: 'content',
      contentType: 'image/png',
      bytes: PNG,
      etag: `"${PNG_SHA}"`,
    });
  });

  it('refuses an extension that is not the stored type', async () => {
    for (const extension of ['jpg', 'webp', 'css']) {
      const answer = await serveBrand(deps({ assets }), {
        tenant: 'acme',
        client: null,
        file: `${PNG_SHA}.${extension}`,
      });
      expect(answer).toBeNull();
    }
  });

  it('refuses a name that is not a lowercase sha256 and an extension without a read', async () => {
    const w = deps({ assets });
    const files = [
      `${PNG_SHA.toUpperCase()}.png`,
      `${PNG_SHA.slice(1)}.png`,
      `${PNG_SHA}a.png`,
      `${PNG_SHA}.svg`,
      `${PNG_SHA}.png.css`,
      PNG_SHA,
      `..%2f${PNG_SHA}.png`,
      '',
    ];
    for (const file of files)
      expect(await serveBrand(w, { tenant: 'acme', client: null, file })).toBeNull();
    expect(w.reads).toEqual([]);
  });

  it('answers nothing for an unknown tenant and nothing for a hash it does not hold', async () => {
    expect(
      await serveBrand(deps({ assets }), { tenant: 'nope', client: null, file: `${PNG_SHA}.png` }),
    ).toBeNull();
    expect(
      await serveBrand(deps({}), { tenant: 'acme', client: null, file: `${PNG_SHA}.png` }),
    ).toBeNull();
  });

  it('refuses a client segment on an image', async () => {
    const answer = await serveBrand(deps({ assets }), {
      tenant: 'acme',
      client: CLIENT_ROW,
      file: `${PNG_SHA}.png`,
    });
    expect(answer).toBeNull();
  });
});

describe('serveBrand stylesheets', () => {
  const tenantLayer = layer(body('.logo{display:none}'), null);
  const clientLayer = layer(body('.brand{color:inherit}'), CLIENT_ROW, 2);

  it('serves the stylesheet the page links, bytes hashing to the URL', async () => {
    const layers = { tenant: tenantLayer, client: null };
    const url = pageStylesheet(layers);
    const request = requestFor(url);
    const answer = await serveBrand(deps({ layers }), request);
    expect(answer).toMatchObject({ contentType: 'text/css; charset=utf-8' });
    expect(sha256Hex(bytesOf(answer))).toBe(parseBrandFile(request.file)?.sha256);
    expect(bytesOf(answer).toString()).toContain('.logo{display:none}');
  });

  it('serves a client-over-tenant stylesheet only under the client that makes it', async () => {
    const layers = { tenant: tenantLayer, client: clientLayer };
    const url = pageStylesheet(layers);
    expect(url).toContain(`/brand/c/${CLIENT_ROW}/`);
    const request = requestFor(url);
    const answer = await serveBrand(deps({ layers }), request);
    expect(bytesOf(answer).toString()).toContain('.brand{color:inherit}');
    const withoutClient = await serveBrand(
      deps({ layers: { tenant: tenantLayer, client: null } }),
      {
        ...request,
        client: null,
      },
    );
    expect(withoutClient).toBeNull();
  });

  it('is another replica answering for a page the first one rendered: only the layers decide', async () => {
    const layers = { tenant: tenantLayer, client: clientLayer };
    const url = pageStylesheet(layers);
    const second = deps({ layers });
    expect(bytesOf(await serveBrand(second, requestFor(url)))).toBeInstanceOf(Buffer);
  });

  it('answers nothing for the previous hash once a new version is published', async () => {
    const before = pageStylesheet({ tenant: tenantLayer, client: null });
    const after = { tenant: layer(body('.logo{display:block}'), null, 2), client: null };
    expect(await serveBrand(deps({ layers: after }), requestFor(before))).toBeNull();
    expect(
      await serveBrand(deps({ layers: after }), requestFor(pageStylesheet(after))),
    ).not.toBeNull();
  });

  it('answers nothing for an unknown hash, a client of no theme, or without an origin', async () => {
    const layers = { tenant: tenantLayer, client: null };
    const url = pageStylesheet(layers);
    const wrong = { ...requestFor(url), file: `${'0'.repeat(64)}.css` };
    expect(await serveBrand(deps({ layers }), wrong)).toBeNull();
    expect(await serveBrand(deps({ layers, origin: undefined }), requestFor(url))).toBeNull();
    expect(await serveBrand(deps({}), requestFor(url))).toBeNull();
  });

  it('refuses a client segment that is not a row id without a read', async () => {
    const w = deps({ layers: { tenant: tenantLayer, client: null } });
    const file = requestFor(pageStylesheet({ tenant: tenantLayer, client: null })).file;
    for (const client of ['app-1', '../x', CLIENT_ROW.toUpperCase(), '']) {
      expect(await serveBrand(w, { tenant: 'acme', client, file })).toBeNull();
    }
    expect(w.reads).toEqual([]);
  });

  it('never serves a stylesheet the check refuses, even from a stored row', async () => {
    const hostile = '@import url(https://evil.example/x.css);.logo{display:none}';
    const layers = { tenant: layer(body(hostile), null), client: null };
    const hash = sha256Hex(brandingCss(tokensCss(body(hostile).tokens), hostile));
    const served = await serveBrand(deps({ layers }), {
      tenant: 'acme',
      client: null,
      file: `${hash}.css`,
    });
    expect(served).toBeNull();
    const own = await serveBrand(deps({ layers }), requestFor(pageStylesheet(layers)));
    expect(bytesOf(own).toString()).not.toContain('evil.example');
  });
});

describe('serveBrand cost of a miss', () => {
  const tenantLayer = layer(body('.logo{display:none}'), null);
  const layers = { tenant: tenantLayer, client: null };
  const real = requestFor(pageStylesheet(layers));
  const random = (n: number) => ({ ...real, file: `${n.toString(16).padStart(64, '0')}.css` });

  it('builds once, then compares random hashes to the remembered one with one small read each', async () => {
    const w = deps({ layers });
    expect(await serveBrand(w, random(1))).toBeNull();
    const built = w.reads.filter((read) => read.startsWith('layers:')).length;
    expect(built).toBe(1);
    for (let n = 2; n < 200; n += 1) expect(await serveBrand(w, random(n))).toBeNull();
    expect(w.reads.filter((read) => read.startsWith('layers:'))).toHaveLength(1);
    expect(bytesOf(await serveBrand(w, real))).not.toHaveLength(0);
    expect(w.reads.filter((read) => read.startsWith('layers:'))).toHaveLength(1);
  });

  it('reads no body for a scope with nothing published', async () => {
    const w = deps({});
    for (let n = 0; n < 20; n += 1) expect(await serveBrand(w, random(n))).toBeNull();
    expect(w.reads.filter((read) => read.startsWith('layers:'))).toEqual([]);
  });

  it('shares one build among concurrent requests for the same versions', async () => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const w = deps({ layers, hold });
    const all = Promise.all(Array.from({ length: 30 }, (_, n) => serveBrand(w, random(n))));
    await Promise.resolve();
    release();
    await all;
    expect(w.reads.filter((read) => read.startsWith('layers:'))).toHaveLength(1);
  });

  it('keeps the memo within its bound across thousands of distinct versions', async () => {
    const memo = createBrandMemo(() => 0);
    for (let version = 1; version <= 5000; version += 1) {
      const next = {
        tenant: layer(body(`.a${String(version)}{top:0}`), null, version),
        client: null,
      };
      const scoped = { ...deps({ layers: next }), memo };
      await serveBrand(scoped, random(version));
    }
    expect(memo.size()).toBeLessThanOrEqual(BRAND_MEMO.maxEntries);
  });

  it('keys by version, so a publish makes the old hash a miss and the new one a build', async () => {
    const memo = createBrandMemo(() => 0);
    const first = { ...deps({ layers }), memo };
    expect(bytesOf(await serveBrand(first, real))).not.toHaveLength(0);
    const next = { tenant: layer(body('.logo{display:block}'), null, 2), client: null };
    const second = { ...deps({ layers: next }), memo };
    expect(await serveBrand(second, real)).toBeNull();
    expect(bytesOf(await serveBrand(second, requestFor(pageStylesheet(next))))).not.toHaveLength(0);
  });

  it('is a 404 for a client segment that resolves to no layer, at one small read', async () => {
    const w = deps({ layers });
    const alias = { ...real, client: CLIENT_ROW };
    expect(await serveBrand(w, alias)).toBeNull();
    expect(w.reads.filter((read) => read.startsWith('layers:'))).toEqual([]);
  });

  it('bounds the builds it shares', () => {
    expect(MAX_BRAND_BUILDS_IN_FLIGHT).toBe(256);
  });
});

describe('serveBrand revalidation', () => {
  const assets = { [PNG_SHA]: { mime: 'image/png', bytes: PNG } };

  it('answers an image from its type alone, never reading the bytes', async () => {
    const w = deps({ assets });
    const answer = await serveBrand(w, {
      tenant: 'acme',
      client: null,
      file: `${PNG_SHA}.png`,
      ifNoneMatch: `"${PNG_SHA}"`,
    });
    expect(answer).toEqual({ kind: 'unchanged', etag: `"${PNG_SHA}"` });
    expect(w.reads.some((read) => read.startsWith('asset:'))).toBe(false);
    const gone = await serveBrand(deps({}), {
      tenant: 'acme',
      client: null,
      file: `${PNG_SHA}.png`,
      ifNoneMatch: `"${PNG_SHA}"`,
    });
    expect(gone).toBeNull();
  });
});

describe('the url shapes', () => {
  it('give a stylesheet and an image paths the parser reads back', () => {
    expect(parseBrandFile(`${PNG_SHA}.webp`)).toEqual({
      kind: 'image',
      sha256: PNG_SHA,
      extension: 'webp',
    });
    expect(parseBrandFile(`${PNG_SHA}.css`)).toEqual({ kind: 'css', sha256: PNG_SHA });
    expect(assetPath('acme', PNG_SHA, 'image/png')).toMatch(/\.png$/u);
    expect(stylesheetPath('acme', 'a{}', CLIENT_ROW)).toBe(
      `/tenants/acme/brand/c/${CLIENT_ROW}/${sha256Hex('a{}')}.css`,
    );
  });
});
