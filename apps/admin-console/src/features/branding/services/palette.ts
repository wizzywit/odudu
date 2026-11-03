import type { FontChoice } from '#/features/branding/types/theme';
import { PALETTE_KEYS } from '@odudu/contracts';
import type { Scheme } from '#/features/branding/services/colourScheme';

export type PaletteKey = (typeof PALETTE_KEYS)[number];

export type Palette = Record<PaletteKey, string>;

export const PALETTE_ORDER: readonly PaletteKey[] = PALETTE_KEYS;

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
