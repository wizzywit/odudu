import { PALETTE_KEYS } from '@odudu/contracts';
import type { Scheme } from '#/features/branding-editor/services/colourScheme';
import {
  DEFAULT_PALETTES,
  type Palette,
  type PaletteKey,
} from '#/features/branding-editor/services/palette';
import type { ColourValues } from '#/features/branding-editor/services/colourValues';

const HEX = /^#[0-9a-f]{6}$/u;

export function isHexColour(value: string): boolean {
  return HEX.test(value);
}

// What is typed into a colour field, as the server stores it.
export function typedColour(text: string): string {
  return text.trim().toLowerCase();
}

const COLOUR_RULE = 'A colour as #rrggbb.';

export function colourProblem(value: string): string | undefined {
  return isHexColour(value) ? undefined : COLOUR_RULE;
}

// The palette as it stands once one colour is changed.
export function withColour(palette: Palette, key: PaletteKey, value: string): Palette {
  return { ...palette, [key]: value };
}

export function paletteProblems(palette: Palette | null): readonly PaletteKey[] {
  return palette === null ? [] : PALETTE_KEYS.filter((key) => !isHexColour(palette[key]));
}

// What the native colour input shows for a value that is not finished yet.
export function swatchOf(value: string): string {
  return isHexColour(value) ? value : '#000000';
}

// The colours of a palette that differ from what the record holds, so a
// changed one can be marked. A palette newly customised marks every colour
// that differs from the one it replaced, none when it was not customised.
export function changedColours(saved: Palette | null, now: Palette | null): readonly PaletteKey[] {
  if (now === null) return [];
  return PALETTE_KEYS.filter((key) => saved?.[key] !== now[key]);
}

export function paletteField(scheme: Scheme): 'tokens.light' | 'tokens.dark' {
  return `tokens.${scheme}`;
}

// A scheme is Instrument's own, or a complete palette of the tenant's that
// starts from Instrument's colours.
export function customisedPalette(scheme: Scheme, custom: boolean): Palette | null {
  return custom ? DEFAULT_PALETTES[scheme] : null;
}

export function editedPalette(
  values: ColourValues,
  scheme: Scheme,
  key: PaletteKey,
  text: string,
): Palette {
  return withColour(values[paletteField(scheme)] ?? DEFAULT_PALETTES[scheme], key, text);
}

// The colour fields still not a finished #rrggbb, by palette key.
export function colourProblems(palette: Palette | null): Partial<Record<PaletteKey, string>> {
  if (palette === null) return {};
  return Object.fromEntries(
    (Object.keys(palette) as PaletteKey[])
      .map((key) => [key, colourProblem(palette[key])] as const)
      .filter(([, problem]) => problem !== undefined),
  );
}

const COLOURS_HOLD = 'Finish each colour as #rrggbb before saving.';

export function coloursHold(values: ColourValues): string | undefined {
  const bad = (['light', 'dark'] as const).some(
    (scheme) => Object.keys(colourProblems(values[paletteField(scheme)])).length > 0,
  );
  return bad ? COLOURS_HOLD : undefined;
}
