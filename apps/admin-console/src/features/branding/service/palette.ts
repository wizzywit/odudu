import { PALETTE_KEYS, type FontChoice } from '@odudu/contracts';

export type PaletteKey = (typeof PALETTE_KEYS)[number];
export type Palette = Record<PaletteKey, string>;
export type Scheme = 'light' | 'dark';

export const PALETTE_ORDER: readonly PaletteKey[] = PALETTE_KEYS;

export const SCHEMES: readonly Scheme[] = ['light', 'dark'];

// The scheme a control's id names, or nothing for any other.
export function schemeOf(id: string): Scheme | undefined {
  return SCHEMES.find((scheme) => scheme === id);
}

export const SCHEME_LABELS: Readonly<Record<Scheme, string>> = { light: 'Light', dark: 'Dark' };

export interface PaletteLabel {
  label: string;
  // A short name for the pair rows: "Muted text on panel".
  short: string;
  description: string;
}

export const PALETTE_LABELS: Readonly<Record<PaletteKey, PaletteLabel>> = {
  surfacePage: {
    label: 'Page background',
    short: 'page',
    description: 'Behind everything on the page.',
  },
  surfacePanel: {
    label: 'Panel background',
    short: 'panel',
    description: 'The card the form sits on.',
  },
  surfaceSunken: {
    label: 'Field background',
    short: 'field background',
    description: 'Inputs and recessed areas.',
  },
  inkPrimary: { label: 'Text', short: 'text', description: 'Headings, labels and body text.' },
  inkMuted: {
    label: 'Muted text',
    short: 'muted text',
    description: 'Hints and secondary text.',
  },
  signalActive: {
    label: 'Accent background',
    short: 'accent background',
    description: 'Highlighted and selected areas.',
  },
  signalActiveInk: {
    label: 'Accent text',
    short: 'accent text',
    description: 'Links and text on the accent.',
  },
  signalDanger: {
    label: 'Error background',
    short: 'error background',
    description: 'Error messages and warnings.',
  },
  signalDangerInk: {
    label: 'Error text',
    short: 'error text',
    description: 'Text and icons for errors.',
  },
  borderStrong: {
    label: 'Border',
    short: 'border',
    description: 'Outlines of inputs and buttons.',
  },
  focusRing: {
    label: 'Focus ring',
    short: 'focus ring',
    description: 'Shows which control the keyboard is on.',
  },
};

// Instrument's own colours, which a palette starts from when it is first
// customised. A test holds them to the console's tokens, and another holds
// them to the server's contrast check.
export const DEFAULT_PALETTES: Readonly<Record<Scheme, Palette>> = {
  light: {
    surfacePage: '#e7eae9',
    surfacePanel: '#ffffff',
    surfaceSunken: '#f3f5f4',
    inkPrimary: '#161b1a',
    inkMuted: '#56605d',
    signalActive: '#dcf0e6',
    signalActiveInk: '#0a6344',
    signalDanger: '#fae3d7',
    signalDangerInk: '#9c3a0e',
    borderStrong: '#898f8d',
    focusRing: '#0a7c55',
  },
  dark: {
    surfacePage: '#151a19',
    surfacePanel: '#1c2221',
    surfaceSunken: '#121716',
    inkPrimary: '#e4e9e7',
    inkMuted: '#9ba6a2',
    signalActive: '#143a2d',
    signalActiveInk: '#6fd8a8',
    signalDanger: '#48220f',
    signalDangerInk: '#f59d73',
    borderStrong: '#656c6a',
    focusRing: '#4fc894',
  },
};

export const FONT_OPTIONS: readonly { id: FontChoice | ''; label: string }[] = [
  { id: '', label: 'Instrument’s own' },
  { id: 'IBM Plex Sans', label: 'IBM Plex Sans' },
  { id: 'IBM Plex Mono', label: 'IBM Plex Mono' },
];

// The font a select's id names, or none for Instrument's own.
export function fontChoice(id: string): FontChoice | null {
  const found = FONT_OPTIONS.find((option) => option.id === id)?.id;
  return found === undefined || found === '' ? null : found;
}

const HEX = /^#[0-9a-f]{6}$/u;

export function isHexColour(value: string): boolean {
  return HEX.test(value);
}

// What is typed into a colour field, as the server stores it.
export function typedColour(text: string): string {
  return text.trim().toLowerCase();
}

export const COLOUR_RULE = 'A colour as #rrggbb.';

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
