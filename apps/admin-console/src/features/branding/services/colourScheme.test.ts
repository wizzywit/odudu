import type { ThemeView } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { pairRows, rowText } from '#/features/branding/services/contrast';
import { MAIL_SCHEME_LABEL } from '#/features/branding/services/mailPreview';
import { schemeTitle } from '#/features/branding/services/mailInheritance';
import { DEFAULT_PALETTES } from '#/features/branding/services/palette';
import { SCHEME_LABELS, SCHEMES, schemeOf } from '#/features/branding/services/colourScheme';
import { PREVIEW_SCHEME_LABEL, SCHEME_OPTIONS } from '#/features/branding/services/preview';
import { sourceReading } from '#/features/branding/services/sources';
import {
  customLabel,
  paletteLegend,
  colourFields,
} from '#/features/branding/services/colourSection';
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
    expect(SCHEME_OPTIONS.find((option) => option.id === scheme)?.label).toBe(name);
    expect(schemeTitle(scheme)).toBe(`${name} colours`);
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
    expect(paletteLegend(SCHEME_LABELS[scheme])).toBe(`${name} colours`);
    expect(customLabel(SCHEME_LABELS[scheme].toLowerCase())).toBe(
      `Use my own ${name.toLowerCase()} colours`,
    );
    const rows = pairRows(scheme, DEFAULT_PALETTES[scheme]);
    expect(rows.map(rowText).every((text) => text.startsWith(`${name}: `))).toBe(true);
  });

  it('lists the options in the order the schemes are', () => {
    expect(SCHEME_OPTIONS.map((option) => option.id)).toEqual([...SCHEMES]);
  });

  it('names the picker the same in the preview and in the mail', () => {
    expect(PREVIEW_SCHEME_LABEL).toBe('Colour scheme');
    expect(MAIL_SCHEME_LABEL).toBe('Colour scheme');
  });
});

describe('schemeOf', () => {
  it('names a scheme for light and dark, and nothing for another id', () => {
    expect(schemeOf('dark')).toBe('dark');
    expect(schemeOf('light')).toBe('light');
    expect(schemeOf('sepia')).toBeUndefined();
  });
});
