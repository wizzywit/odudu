import { PAGE_KINDS, type PageKind } from '@odudu/kernel';

import { type ThemeAssets, type ThemeBody, type TokenGroups } from '#/service/body';

const GROUPS = ['light', 'dark', 'font'] as const satisfies readonly (keyof TokenGroups)[];
const SLOTS = [
  'logo',
  'darkLogo',
  'favicon',
  'background',
] as const satisfies readonly (keyof ThemeAssets)[];
const KINDS = Object.keys(PAGE_KINDS) as PageKind[];

export type PieceName =
  | `tokens.${(typeof GROUPS)[number]}`
  | 'stylesheet'
  | `templates.${PageKind}`
  | `assets.${(typeof SLOTS)[number]}`;

export const PIECE_NAMES: readonly PieceName[] = [
  ...GROUPS.map((group): PieceName => `tokens.${group}`),
  'stylesheet',
  ...KINDS.map((kind): PieceName => `templates.${kind}`),
  ...SLOTS.map((slot): PieceName => `assets.${slot}`),
];

const HOLDERS: Record<PieceName, (body: ThemeBody) => unknown> = {
  'tokens.light': (body) => body.tokens.light,
  'tokens.dark': (body) => body.tokens.dark,
  'tokens.font': (body) => body.tokens.font,
  stylesheet: (body) => body.stylesheet,
  ...Object.fromEntries(
    KINDS.map((kind) => [`templates.${kind}`, (body: ThemeBody) => body.templates[kind]]),
  ),
  'assets.logo': (body) => body.assets.logo,
  'assets.darkLogo': (body) => body.assets.darkLogo,
  'assets.favicon': (body) => body.assets.favicon,
  'assets.background': (body) => body.assets.background,
} as Record<PieceName, (body: ThemeBody) => unknown>;

function has(body: ThemeBody, name: PieceName): boolean {
  const value = HOLDERS[name](body);
  return value !== undefined && value !== null;
}

// Layers run most specific first. For each piece, the index of the first
// layer that holds it, or null when none does.
export function pieceSources(
  layers: readonly (ThemeBody | null)[],
): Record<PieceName, number | null> {
  const sources = {} as Record<PieceName, number | null>;
  for (const name of PIECE_NAMES) {
    const index = layers.findIndex((layer) => layer !== null && has(layer, name));
    sources[name] = index === -1 ? null : index;
  }
  return sources;
}

// Each piece comes whole from the first layer that has it: a palette group
// is never merged colour by colour, a template never line by line.
export function resolvePieces(layers: readonly (ThemeBody | null)[]): ThemeBody {
  const present = layers.filter((layer): layer is ThemeBody => layer !== null);
  const resolved: ThemeBody = { tokens: {}, stylesheet: null, templates: {}, assets: {} };
  for (const layer of present.toReversed()) {
    Object.assign(resolved.tokens, layer.tokens);
    Object.assign(resolved.templates, layer.templates);
    Object.assign(resolved.assets, layer.assets);
    if (layer.stylesheet !== null) resolved.stylesheet = layer.stylesheet;
  }
  return structuredClone(resolved);
}
