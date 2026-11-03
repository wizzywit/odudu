import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAIL_PALETTE } from '#/service/palette.generated';
import { contrastRatio, mailPalette, MAIL_ROLES, readTokenPalette } from '#/service/palette';

const TOKENS = path.resolve(
  import.meta.dirname,
  '../../../../apps/admin-console/src/shared/ui/tokens.css',
);

describe('readTokenPalette', () => {
  it('reads each colour token as a light and a dark hex', () => {
    const palette = readTokenPalette(
      `:root { --ink-primary: light-dark(#161B1A, #e4e9e7); --space-1: 4px; }`,
    );
    expect(palette.get('--ink-primary')).toEqual({ light: '#161b1a', dark: '#e4e9e7' });
    expect(palette.has('--space-1')).toBe(false);
  });

  it('refuses a colour token that is not a light-dark pair of hex', () => {
    expect(() => readTokenPalette(':root { --ink-primary: #161b1a; }')).toThrow(/--ink-primary/u);
  });

  it('refuses a token declared twice', () => {
    expect(() =>
      readTokenPalette(
        ':root { --border: light-dark(#d4d9d7, #2a3230); } p { --border: light-dark(#000000, #ffffff); }',
      ),
    ).toThrow(/more than once/u);
  });

  it('ignores a declaration inside a comment', () => {
    const palette = readTokenPalette(
      '/* --border: nonsense; */ :root { --border: light-dark(#d4d9d7, #2a3230); }',
    );
    expect(palette.get('--border')).toEqual({ light: '#d4d9d7', dark: '#2a3230' });
  });
});

describe('the committed mail palette', () => {
  it('is the console tokens compiled to hex, with no value copied by hand', async () => {
    const compiled = mailPalette(await readFile(TOKENS, 'utf8'));
    expect(MAIL_PALETTE).toEqual(compiled);
  });

  it('names a token for every role', () => {
    for (const scheme of ['light', 'dark'] as const) {
      expect(Object.keys(MAIL_PALETTE[scheme]).sort()).toEqual(Object.keys(MAIL_ROLES).sort());
    }
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5);
  });
});

describe('every text pair in the mail holds WCAG AA in both palettes', () => {
  const pairs = [
    ['ink', 'panel'],
    ['muted', 'panel'],
    ['link', 'panel'],
    ['ink', 'sunken'],
    ['link', 'sunken'],
    ['buttonInk', 'button'],
    ['ink', 'page'],
    ['muted', 'page'],
    ['railInk', 'rail'],
  ] as const;

  it.each(['light', 'dark'] as const)('%s', (scheme) => {
    const colours = MAIL_PALETTE[scheme];
    const failures = pairs.flatMap(([ink, surface]) => {
      const ratio = contrastRatio(colours[ink], colours[surface]);
      return ratio >= 4.5 ? [] : [`${ink} on ${surface}: ${ratio.toFixed(2)}`];
    });
    expect(failures).toEqual([]);
  });
});
