import { PAGE_KINDS, type PageKind } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';

import { type Palette, type ThemeBody } from '#/service/body';
import { PIECE_NAMES, pieceSources, resolvePieces } from '#/service/resolve';

const EMPTY: ThemeBody = { tokens: {}, stylesheet: null, templates: {}, assets: {} };

function palette(ink: string): Palette {
  return {
    surfacePage: '#ffffff',
    surfacePanel: '#ffffff',
    surfaceSunken: '#ffffff',
    inkPrimary: ink,
    inkMuted: '#767676',
    signalActive: '#ffffff',
    signalActiveInk: '#000000',
    signalDanger: '#ffffff',
    signalDangerInk: '#000000',
    borderStrong: '#949494',
    focusRing: '#949494',
  };
}

const ASSET_A = '00000000-0000-4000-8000-00000000000a';
const ASSET_B = '00000000-0000-4000-8000-00000000000b';

describe('resolvePieces', () => {
  it('a client template overrides only that page kind', () => {
    const tenant: ThemeBody = {
      ...EMPTY,
      templates: { 'sign-in': 'tenant sign-in', consent: 'tenant consent' },
    };
    const client: ThemeBody = { ...EMPTY, templates: { 'sign-in': 'client sign-in' } };
    expect(resolvePieces([client, tenant]).templates).toEqual({
      'sign-in': 'client sign-in',
      consent: 'tenant consent',
    });
  });

  it('a client palette group replaces the tenant group whole', () => {
    const tenant: ThemeBody = {
      ...EMPTY,
      tokens: { light: palette('#111111'), dark: palette('#eeeeee'), font: 'IBM Plex Mono' },
    };
    const client: ThemeBody = { ...EMPTY, tokens: { light: palette('#222222') } };
    const resolved = resolvePieces([client, tenant]);
    expect(resolved.tokens.light).toEqual(palette('#222222'));
    expect(resolved.tokens.dark).toEqual(palette('#eeeeee'));
    expect(resolved.tokens.font).toBe('IBM Plex Mono');
  });

  it('takes the stylesheet and each asset slot from the first layer that has one', () => {
    const tenant: ThemeBody = {
      ...EMPTY,
      stylesheet: 'a{}',
      assets: { logo: { assetId: ASSET_A, alt: 'tenant' }, favicon: { assetId: ASSET_A } },
    };
    const client: ThemeBody = { ...EMPTY, assets: { logo: { assetId: ASSET_B, alt: 'client' } } };
    const resolved = resolvePieces([client, tenant]);
    expect(resolved.stylesheet).toBe('a{}');
    expect(resolved.assets).toEqual({
      logo: { assetId: ASSET_B, alt: 'client' },
      favicon: { assetId: ASSET_A },
    });
  });

  it('falls through to absent when no layer has a piece', () => {
    expect(resolvePieces([null, EMPTY, null])).toEqual(EMPTY);
    expect(resolvePieces([])).toEqual(EMPTY);
  });
});

describe('resolvePieces isolation', () => {
  it('shares no nested object with the layers it read', () => {
    const layer: ThemeBody = {
      ...EMPTY,
      tokens: { light: palette('#111111') },
      assets: { logo: { assetId: ASSET_A, alt: 'a' } },
    };
    const resolved = resolvePieces([layer]);
    if (resolved.tokens.light !== undefined) resolved.tokens.light.inkPrimary = '#000000';
    if (resolved.assets.logo !== undefined) resolved.assets.logo.alt = 'changed';
    expect(layer.tokens.light?.inkPrimary).toBe('#111111');
    expect(layer.assets.logo?.alt).toBe('a');
  });
});

describe('PIECE_NAMES', () => {
  it('names every piece a body can hold', () => {
    const templates: Partial<Record<PageKind, string>> = {};
    for (const kind of Object.keys(PAGE_KINDS) as PageKind[]) templates[kind] = kind;
    const full: ThemeBody = {
      tokens: { light: palette('#111111'), dark: palette('#eeeeee'), font: 'IBM Plex Sans' },
      stylesheet: 'a{}',
      templates,
      assets: {
        logo: { assetId: ASSET_A, alt: 'a' },
        darkLogo: { assetId: ASSET_A, alt: 'a' },
        favicon: { assetId: ASSET_A },
        background: { assetId: ASSET_A },
      },
    };
    const sources = pieceSources([full]);
    expect(PIECE_NAMES.filter((name) => sources[name] !== 0)).toEqual([]);
    expect(resolvePieces([full])).toEqual(full);
  });
});

describe('pieceSources', () => {
  it('reports which layer supplied each piece', () => {
    const tenant: ThemeBody = {
      ...EMPTY,
      stylesheet: 'a{}',
      tokens: { dark: palette('#eeeeee') },
      templates: { consent: 'x' },
    };
    const client: ThemeBody = {
      ...EMPTY,
      tokens: { light: palette('#222222') },
      templates: { 'sign-in': 'y' },
    };
    const sources = pieceSources([client, tenant]);
    expect(sources['tokens.light']).toBe(0);
    expect(sources['tokens.dark']).toBe(1);
    expect(sources['tokens.font']).toBeNull();
    expect(sources.stylesheet).toBe(1);
    expect(sources['templates.sign-in']).toBe(0);
    expect(sources['templates.consent']).toBe(1);
    expect(sources['templates.logged-out']).toBeNull();
    expect(sources['assets.logo']).toBeNull();
  });

  it('skips a missing layer without shifting the indices', () => {
    const tenant: ThemeBody = { ...EMPTY, stylesheet: 'a{}' };
    expect(pieceSources([null, tenant]).stylesheet).toBe(1);
  });
});
