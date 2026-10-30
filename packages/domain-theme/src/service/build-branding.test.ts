import { describe, expect, it } from 'vitest';
import { buildBranding } from '#/service/build-branding';
import { type PublishedLayer } from '#/service/record';

const ORIGIN = 'https://id.example.test';

function layer(
  body: unknown,
  clientId: string | null = null,
  assets: PublishedLayer['assets'] = [],
) {
  return { versionId: 'v', clientId, version: 3, body, assets };
}

const GOOD = { tokens: {}, stylesheet: null, templates: {}, assets: {} };
const NEEDS_FORM = '<p>no form here</p>';
const SIGN_IN = '{{error}}{{form.open}}{{fields}}{{submit}}{{form.close}}{{links}}';

function build(layers: { name: 'client' | 'tenant'; layer: PublishedLayer }[]) {
  return buildBranding({ tenantName: 'acme', origin: ORIGIN, layers });
}

describe('what a build says about the layers it read', () => {
  it('names the layers it used, most specific first, and no fault', () => {
    const out = build([
      { name: 'client', layer: layer({ ...GOOD, stylesheet: '.page{color:#111111}' }, 'c1') },
      { name: 'tenant', layer: layer({ ...GOOD, stylesheet: '.page{color:#222222}' }) },
    ]);
    expect(out.used).toEqual(['client', 'tenant']);
    expect(out.faults).toEqual([]);
  });

  it('names a layer whose body does not parse, and uses the one below', () => {
    const out = build([
      { name: 'client', layer: layer({ nonsense: true }, 'c1') },
      { name: 'tenant', layer: layer({ ...GOOD, stylesheet: '.page{color:#222222}' }) },
    ]);
    expect(out.used).toEqual(['tenant']);
    expect(out.faults).toEqual([{ layer: 'client', code: 'invalid_body' }]);
  });

  it('names a layer whose image is gone', () => {
    const out = build([
      {
        name: 'tenant',
        layer: layer({
          ...GOOD,
          assets: { logo: { assetId: '0198f2a0-0000-7000-8000-000000000001', alt: 'x' } },
        }),
      },
    ]);
    expect(out.used).toEqual([]);
    expect(out.branding).toBeNull();
    expect(out.faults).toEqual([{ layer: 'tenant', code: 'image_gone' }]);
  });

  it('names a stylesheet that fails and still uses the layer', () => {
    const out = build([
      {
        name: 'tenant',
        layer: layer({ ...GOOD, stylesheet: '@import url(https://evil.test/x.css);' }),
      },
    ]);
    expect(out.faults).toEqual([{ layer: 'tenant', code: 'stylesheet_refused' }]);
    // Nothing else is set, so what is left of the layer is the default look.
    expect(out.used).toEqual([]);
  });

  it('says which layer a refused template was in, with its codes', () => {
    const out = build([
      { name: 'client', layer: layer({ ...GOOD, templates: { 'sign-in': NEEDS_FORM } }, 'c1') },
      { name: 'tenant', layer: layer({ ...GOOD, templates: { 'sign-in': SIGN_IN } }) },
    ]);
    expect(out.refused).toHaveLength(1);
    expect(out.refused[0]).toMatchObject({ layer: 'client', kind: 'sign-in' });
    expect(out.refused[0]?.reason).not.toBe('');
    expect(out.used).toEqual(['client', 'tenant']);
  });
});
