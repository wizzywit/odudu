import { THEME_PAGE_KINDS } from '@odudu/contracts';
import { PAGE_KINDS } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';

import { FONT_CHOICES, assetIdsOf, parseThemeBody } from '#/service/body';

const ID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';

const PALETTE = {
  surfacePage: '#FFFFFF',
  surfacePanel: '#ffffff',
  surfaceSunken: '#ffffff',
  inkPrimary: '#000000',
  inkMuted: '#767676',
  signalActive: '#ffffff',
  signalActiveInk: '#000000',
  signalDanger: '#ffffff',
  signalDangerInk: '#000000',
  borderStrong: '#949494',
  focusRing: '#949494',
};

function paths(input: unknown): string[] {
  const parsed = parseThemeBody(input);
  return parsed.ok ? [] : parsed.issues.map((issue) => issue.path);
}

describe('parseThemeBody', () => {
  it('parses an empty body to an all-absent body', () => {
    expect(parseThemeBody({})).toEqual({
      ok: true,
      body: { tokens: {}, stylesheet: null, templates: {}, assets: {} },
    });
  });

  it('round-trips a full valid body, lower-casing colours', () => {
    const input = {
      tokens: { light: PALETTE, dark: PALETTE, font: FONT_CHOICES[0] },
      stylesheet: 'a { color: red }',
      templates: { 'sign-in': '<form></form>' },
      assets: {
        logo: { assetId: ID, alt: 'Acme' },
        darkLogo: { assetId: ID, alt: 'Acme dark' },
        favicon: { assetId: ID },
        background: { assetId: ID },
      },
    };
    const parsed = parseThemeBody(input);
    expect(parsed).toEqual({
      ok: true,
      body: {
        ...input,
        tokens: {
          ...input.tokens,
          light: { ...PALETTE, surfacePage: '#ffffff' },
          dark: { ...PALETTE, surfacePage: '#ffffff' },
        },
      },
    });
  });

  it('refuses an asset id that is not a UUID, naming the path', () => {
    expect(paths({ assets: { logo: { assetId: 'nope', alt: 'x' } } })).toEqual([
      '/assets/logo/assetId',
    ]);
    expect(paths({ assets: { favicon: { assetId: 'nope' } } })).toEqual([
      '/assets/favicon/assetId',
    ]);
  });

  it('lower-cases asset ids so two spellings are one id', () => {
    const parsed = parseThemeBody({ assets: { logo: { assetId: ID.toUpperCase(), alt: 'x' } } });
    expect(parsed.ok && parsed.body.assets.logo?.assetId).toBe(ID);
  });

  // Zod's record parser skips `__proto__` rather than reporting it, so the
  // key is dropped; what matters is that it neither lands nor repoints.
  it('drops a __proto__ template key without touching the prototype', () => {
    const templates: unknown = JSON.parse('{"__proto__": "x"}');
    const parsed = parseThemeBody({ templates });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.keys(parsed.body.templates)).toEqual([]);
    expect(Object.getPrototypeOf(parsed.body.templates)).toBe(Object.prototype);
    expect(Object.getOwnPropertyNames(parsed.body.templates)).toEqual([]);
  });

  it('refuses a logo without alt text, an empty one or an overlong one', () => {
    expect(paths({ assets: { logo: { assetId: ID } } })).toEqual(['/assets/logo/alt']);
    expect(paths({ assets: { logo: { assetId: ID, alt: '' } } })).toEqual(['/assets/logo/alt']);
    expect(paths({ assets: { logo: { assetId: ID, alt: '  \t ' } } })).toEqual([
      '/assets/logo/alt',
    ]);
    expect(paths({ assets: { darkLogo: { assetId: ID, alt: 'x'.repeat(201) } } })).toEqual([
      '/assets/darkLogo/alt',
    ]);
  });

  it('refuses unknown keys at every level', () => {
    expect(paths({ extra: 1 })).toEqual(['/extra']);
    expect(paths({ assets: { logo: { assetId: ID, alt: 'x', size: 1 } } })).toEqual([
      '/assets/logo/size',
    ]);
    expect(paths({ tokens: { light: { ...PALETTE, accent: '#000000' } } })).toEqual([
      '/tokens/light/accent',
    ]);
    expect(paths({ templates: { nonsense: 'x' } })).toEqual(['/templates/nonsense']);
  });

  it('refuses a colour that is not a six-digit hex', () => {
    for (const value of ['#fff', 'rgb(0,0,0)', 'red', '#12345g', '#1234567', 'url(x)']) {
      expect(paths({ tokens: { dark: { ...PALETTE, focusRing: value } } })).toEqual([
        '/tokens/dark/focusRing',
      ]);
    }
  });

  it('refuses an incomplete palette group', () => {
    const rest: Record<string, string> = { ...PALETTE };
    delete rest.focusRing;
    expect(paths({ tokens: { light: rest } })).toEqual(['/tokens/light/focusRing']);
  });

  it('refuses a font outside the self-hosted families', () => {
    expect(paths({ tokens: { font: 'Comic Sans' } })).toEqual(['/tokens/font']);
  });

  it('bounds the template and stylesheet sizes in bytes', () => {
    expect(parseThemeBody({ templates: { consent: 'a'.repeat(64 * 1024) } }).ok).toBe(true);
    expect(paths({ templates: { consent: 'a'.repeat(64 * 1024 + 1) } })).toEqual([
      '/templates/consent',
    ]);
    expect(paths({ templates: { consent: 'é'.repeat(33 * 1024) } })).toEqual([
      '/templates/consent',
    ]);
    expect(parseThemeBody({ stylesheet: 'a'.repeat(128 * 1024) }).ok).toBe(true);
    expect(paths({ stylesheet: 'a'.repeat(128 * 1024 + 1) })).toEqual(['/stylesheet']);
  });

  it('refuses a non-object body', () => {
    expect(paths(null)).toEqual(['']);
    expect(paths('x')).toEqual(['']);
  });
});

describe('assetIdsOf', () => {
  it('lists each asset once however many slots name it', () => {
    expect(assetIdsOf({})).toEqual([]);
    expect(assetIdsOf({ logo: { assetId: ID, alt: 'a' }, favicon: { assetId: ID } })).toEqual([ID]);
  });
});

describe('the contract the body is parsed against', () => {
  it('lists exactly the page kinds the kernel manifest does', () => {
    expect([...THEME_PAGE_KINDS].sort()).toEqual(Object.keys(PAGE_KINDS).sort());
  });
});
