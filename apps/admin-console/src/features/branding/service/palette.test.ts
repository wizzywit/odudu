import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PALETTE_KEYS } from '@odudu/contracts';
import { describe, expect, it } from 'vitest';
import {
  colourProblem,
  DEFAULT_PALETTES,
  fontChoice,
  isHexColour,
  paletteProblems,
  schemeOf,
  swatchOf,
  typedColour,
  withColour,
} from '#/features/branding/service';

const PROPERTY: Record<(typeof PALETTE_KEYS)[number], string> = {
  surfacePage: '--surface-page',
  surfacePanel: '--surface-panel',
  surfaceSunken: '--surface-sunken',
  inkPrimary: '--ink-primary',
  inkMuted: '--ink-muted',
  signalActive: '--signal-active',
  signalActiveInk: '--signal-active-ink',
  signalDanger: '--signal-danger',
  signalDangerInk: '--signal-danger-ink',
  borderStrong: '--border-strong',
  focusRing: '--focus-ring',
};

const TOKENS = readFileSync(
  path.resolve(import.meta.dirname, '../../../shared/view/tokens.css'),
  'utf8',
);

function pair(property: string): [string, string] {
  const found = new RegExp(`${property}: light-dark\\((#[0-9a-f]{6}), (#[0-9a-f]{6})\\)`, 'u').exec(
    TOKENS,
  );
  if (found?.[1] === undefined || found[2] === undefined) throw new Error(`no ${property}`);
  return [found[1], found[2]];
}

describe('the palettes customising starts from', () => {
  it.each(PALETTE_KEYS)('%s is the console’s own token, in both schemes', (key) => {
    const [light, dark] = pair(PROPERTY[key]);
    expect(DEFAULT_PALETTES.light[key]).toBe(light);
    expect(DEFAULT_PALETTES.dark[key]).toBe(dark);
  });
});

describe('a colour as typed', () => {
  it('is lowercased and trimmed, and finished only as #rrggbb', () => {
    expect(typedColour('  #A0B1C2 ')).toBe('#a0b1c2');
    expect(isHexColour('#a0b1c2')).toBe(true);
    expect(isHexColour('#a0b1c')).toBe(false);
    expect(isHexColour('a0b1c2')).toBe(false);
    expect(colourProblem('#zzz')).toBe('A colour as #rrggbb.');
    expect(colourProblem('#000000')).toBeUndefined();
  });

  it('shows black in the picker until it is finished', () => {
    expect(swatchOf('#1')).toBe('#000000');
    expect(swatchOf('#123456')).toBe('#123456');
  });

  it('changes one colour of a palette and leaves the rest', () => {
    const changed = withColour(DEFAULT_PALETTES.light, 'inkPrimary', '#000000');
    expect(changed.inkPrimary).toBe('#000000');
    expect(changed.surfacePage).toBe(DEFAULT_PALETTES.light.surfacePage);
    expect(paletteProblems({ ...changed, focusRing: '#1' })).toEqual(['focusRing']);
    expect(paletteProblems(null)).toEqual([]);
  });
});

describe('the font', () => {
  it('is Instrument’s own for an empty choice and none other than the families served', () => {
    expect(fontChoice('')).toBeNull();
    expect(fontChoice('Comic Sans')).toBeNull();
    expect(fontChoice('IBM Plex Mono')).toBe('IBM Plex Mono');
  });
});

describe('schemeOf', () => {
  it('names a scheme for light and dark, and nothing for another id', () => {
    expect(schemeOf('dark')).toBe('dark');
    expect(schemeOf('light')).toBe('light');
    expect(schemeOf('sepia')).toBeUndefined();
  });
});
