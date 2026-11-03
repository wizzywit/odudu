import type { ThemeView } from '#/features/branding/types/theme';
import { describe, expect, it } from 'vitest';
import { pairRows, rowText } from '#/features/branding/services/contrast';
import { DEFAULT_PALETTES } from '#/features/branding/services/palette';
import {
  SCHEME_LABELS,
  SCHEME_PICKER_LABEL,
  SCHEMES,
  schemeColoursName,
  schemeColoursTitle,
  schemeOf,
  schemeOptions,
} from '#/features/branding/services/colourScheme';
import { sourceReading } from '#/features/branding/services/sources';
import { customLabel, colourFields } from '#/features/branding/services/colourSection';
import { themeView } from '#/testing/brandingFixtures';

const NAMES = { light: 'Light', dark: 'Dark' } as const;

function hiddenReading(piece: string): string {
  const view = themeView({ sources: { [piece]: 'client' } }) as ThemeView;
  const scope = { kind: 'client', id: 'c1', below: { [piece]: 'tenant' } } as const;
  return sourceReading(scope, view, piece);
}

describe('how a colour scheme is spelled', () => {
  it.each(SCHEMES)('says the %s scheme in each of its forms', (scheme) => {
    const name = NAMES[scheme];
    expect(SCHEME_LABELS[scheme]).toBe(name);
    expect(schemeOptions.find((option) => option.id === scheme)?.label).toBe(name);
    expect(schemeColoursTitle(scheme)).toBe(`${name} colours`);
    expect(
      colourFields({
        'tokens.light': null,
        'tokens.dark': null,
        'tokens.font': null,
      })[`tokens.${scheme}`].label,
    ).toBe(`${name} colours`);
    expect(hiddenReading(`tokens.${scheme}`)).toContain(
      `the tenant’s ${name.toLowerCase()} colours`,
    );
    expect(schemeColoursName(scheme)).toBe(`${name.toLowerCase()} colours`);
    expect(customLabel(scheme)).toBe(`Use my own ${name.toLowerCase()} colours`);
    const rows = pairRows(scheme, DEFAULT_PALETTES[scheme]);
    expect(rows.map(rowText).every((text) => text.startsWith(`${name}: `))).toBe(true);
  });

  it('lists the options in the order the schemes are', () => {
    expect(schemeOptions.map((option) => option.id)).toEqual([...SCHEMES]);
  });

  it('names the picker the same in the preview and in the mail', () => {
    expect(SCHEME_PICKER_LABEL).toBe('Colour scheme');
  });
});

describe('schemeOf', () => {
  it('names a scheme for light and dark, and nothing for another id', () => {
    expect(schemeOf('dark')).toBe('dark');
    expect(schemeOf('light')).toBe('light');
    expect(schemeOf('sepia')).toBeUndefined();
  });
});
