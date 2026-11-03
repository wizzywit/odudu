import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PALETTE_KEYS } from '@odudu/contracts';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTES, fontChoice } from '#/features/branding/services/palette';

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
  path.resolve(import.meta.dirname, '../../../shared/ui/tokens.css'),
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

describe('the font', () => {
  it('is Instrument’s own for an empty choice and none other than the families served', () => {
    expect(fontChoice('')).toBeNull();
    expect(fontChoice('Comic Sans')).toBeNull();
    expect(fontChoice('IBM Plex Mono')).toBe('IBM Plex Mono');
  });
});
