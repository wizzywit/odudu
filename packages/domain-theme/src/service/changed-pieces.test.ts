import { describe, expect, it } from 'vitest';

import { type Palette, type ThemeBody } from '#/service/body';
import { changedPieces } from '#/service/changed-pieces';

const EMPTY: ThemeBody = { tokens: {}, stylesheet: null, templates: {}, assets: {} };
const ASSET = '00000000-0000-4000-8000-00000000000a';

const PALETTE: Palette = {
  surfacePage: '#ffffff',
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

describe('changedPieces', () => {
  it('names nothing without a draft', () => {
    expect(changedPieces(null, EMPTY)).toEqual([]);
    expect(changedPieces(null, null)).toEqual([]);
  });

  it('compares a draft with nothing published to the empty theme', () => {
    expect(changedPieces(EMPTY, null)).toEqual([]);
    expect(changedPieces({ ...EMPTY, stylesheet: 'a{}' }, null)).toEqual(['stylesheet']);
  });

  it.each([
    ['tokens', { tokens: { font: 'IBM Plex Mono' } }],
    ['stylesheet', { stylesheet: '.page { color: red; }' }],
    ['templates', { templates: { 'sign-in': 'x' } }],
    ['assets', { assets: { favicon: { assetId: ASSET } } }],
  ] as const)('names %s when only it differs', (piece, change) => {
    expect(changedPieces({ ...EMPTY, ...change }, EMPTY)).toEqual([piece]);
  });

  it('names the pieces in a fixed order', () => {
    const draft: ThemeBody = {
      tokens: { light: PALETTE },
      stylesheet: 'a{}',
      templates: { 'sign-in': 'x' },
      assets: { favicon: { assetId: ASSET } },
    };
    expect(changedPieces(draft, EMPTY)).toEqual(['tokens', 'assets', 'stylesheet', 'templates']);
  });

  it('is empty once a draft has the published content, however it was written', () => {
    const published: ThemeBody = {
      tokens: { light: PALETTE, font: 'IBM Plex Mono' },
      stylesheet: null,
      templates: { 'sign-in': 'x', consent: 'y' },
      assets: { logo: { assetId: ASSET, alt: 'Logo' } },
    };
    const reordered = {
      assets: { logo: { alt: 'Logo', assetId: ASSET.toUpperCase() } },
      templates: { consent: 'y', 'sign-in': 'x' },
      tokens: { font: 'IBM Plex Mono', light: { ...PALETTE, surfacePage: '#FFFFFF' } },
      stylesheet: null,
    } as unknown as ThemeBody;
    expect(changedPieces(reordered, published)).toEqual([]);
  });

  it('sees a template removed from the draft', () => {
    const published: ThemeBody = { ...EMPTY, templates: { 'sign-in': 'x' } };
    expect(changedPieces(EMPTY, published)).toEqual(['templates']);
  });
});
