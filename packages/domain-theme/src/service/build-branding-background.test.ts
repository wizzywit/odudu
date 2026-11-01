import { describe, expect, it } from 'vitest';
import { backgroundCss, brandingCss, tokensCss } from '#/service/branding-css';
import { buildBranding } from '#/service/build-branding';
import { type PublishedLayer } from '#/service/record';

const ORIGIN = 'https://id.example.test';
const GOOD = { tokens: {}, stylesheet: null, templates: {}, assets: {} };

const ASSET = {
  id: '0198f2a0-0000-7000-8000-0000000000b1',
  sha256: 'b'.repeat(64),
  mime: 'image/png',
  width: 8,
  height: 8,
};

function layer(
  body: unknown,
  clientId: string | null,
  assets: PublishedLayer['assets'],
): PublishedLayer {
  return { versionId: 'v', clientId, version: 3, body, assets };
}

function tenantWithBackground(stylesheet: string | null = null) {
  return {
    name: 'tenant' as const,
    layer: layer({ ...GOOD, stylesheet, assets: { background: { assetId: ASSET.id } } }, null, [
      ASSET,
    ]),
  };
}

function build(
  layers: { name: 'client' | 'tenant'; layer: PublishedLayer }[],
  tenantName = 'acme',
) {
  return buildBranding({ tenantName, origin: ORIGIN, layers });
}

describe('the background image', () => {
  it('is drawn behind the page by a rule in the stylesheet', () => {
    const out = build([tenantWithBackground()]);
    const url = `/tenants/acme/brand/${ASSET.sha256}.png`;
    expect(out.css).toContain(`body{background-image:url('${url}');`);
    expect(out.css).toContain('background-size:cover');
    expect(out.branding?.stylesheetUrl).not.toBeNull();
    expect(out.branding?.assetUrls).toEqual([url]);
  });

  it('comes before the theme stylesheet, so the theme can override it', () => {
    const out = build([tenantWithBackground('.logo{display:none}')]);
    expect(out.css.indexOf('background-image:url(')).toBeGreaterThan(-1);
    expect(out.css.indexOf('background-image:url(')).toBeLessThan(
      out.css.indexOf('.logo{display:none}'),
    );
  });

  it("is the client's own when a client sets one, else the tenant's", () => {
    const other = { ...ASSET, id: '0198f2a0-0000-7000-8000-0000000000b2', sha256: 'c'.repeat(64) };
    const client = {
      name: 'client' as const,
      layer: layer({ ...GOOD, assets: { background: { assetId: other.id } } }, 'c1', [other]),
    };
    const over = build([client, tenantWithBackground()]).css;
    expect(over).toContain(other.sha256);
    expect(over).not.toContain(ASSET.sha256);
    const bare = { name: 'client' as const, layer: layer(GOOD, 'c1', []) };
    expect(build([bare, tenantWithBackground()]).css).toContain(ASSET.sha256);
  });

  it('writes a url that nothing in the path can break out of', () => {
    const rule = backgroundCss('/x\');}body{y:z\\ a"');
    const inside = /url\('(.*)'\)/u.exec(rule)?.[1] ?? '';
    expect(inside).not.toMatch(/['")\\\s]/u);
    expect(inside).toContain('%27');
    expect(inside).toContain('%29');
    expect(rule.match(/[()]/gu)).toHaveLength(2);
  });

  it('adds nothing for a theme with no background', () => {
    const out = build([
      { name: 'tenant', layer: layer({ ...GOOD, stylesheet: '.logo{display:none}' }, null, []) },
    ]);
    expect(out.css).toBe(brandingCss(tokensCss({}), '.logo{display:none}'));
  });
});
