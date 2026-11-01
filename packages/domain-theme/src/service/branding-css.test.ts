import { describe, expect, it } from 'vitest';
import { type Palette } from '#/service/body';
import { brandingCss, tokensCss } from '#/service/branding-css';

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

describe('tokensCss', () => {
  it('is empty for a theme with no tokens', () => {
    expect(tokensCss({})).toBe('');
  });

  it('sets every property of a palette under its scheme only', () => {
    const css = tokensCss({ light: PALETTE });
    expect(css).toContain('--surface-page:#ffffff;');
    expect(css).toContain('--focus-ring:#0044aa;');
    expect(css).toContain('@media (prefers-color-scheme:light){:root:not([data-theme]){');
    expect(css).toContain(":root[data-theme='light']{");
    expect(css).not.toContain('dark');
  });

  it('writes the font as the sans family', () => {
    expect(tokensCss({ font: 'IBM Plex Mono' })).toBe(
      ":root{--font-sans:'IBM Plex Mono', ui-monospace, monospace;}\n",
    );
  });

  it('names no url, import or inline style', () => {
    const css = tokensCss({ light: PALETTE, dark: PALETTE, font: 'IBM Plex Sans' });
    expect(css).not.toMatch(/url\(|@import|<|expression/iu);
  });
});

describe('brandingCss', () => {
  it('puts the theme rules after the tokens', () => {
    expect(brandingCss(':root{}\n', '.logo{display:none}')).toBe(':root{}\n.logo{display:none}\n');
    expect(brandingCss(':root{}\n', null)).toBe(':root{}\n');
  });
});
