import { parseThemeBody, type ThemeBody } from '#/service/body';

// The same list as THEME_DIFF_PIECES in @odudu/contracts/admin, which a test
// holds equal.
export const DIFF_PIECES = ['tokens', 'assets', 'stylesheet', 'templates'] as const;
export type DiffPiece = (typeof DIFF_PIECES)[number];

const EMPTY: ThemeBody = { tokens: {}, stylesheet: null, templates: {}, assets: {} };

// A body as saves store it: parsed and lower-cased, so a draft written with
// the same content in another key order or case compares equal.
function stored(body: ThemeBody): ThemeBody {
  const parsed = parseThemeBody(body);
  return parsed.ok ? parsed.body : body;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

// The pieces of a draft that differ from the published body of the same
// scope; nothing published compares as the empty theme. No draft differs in
// nothing.
export function changedPieces(draft: ThemeBody | null, published: ThemeBody | null): DiffPiece[] {
  if (draft === null) return [];
  const mine = stored(draft);
  const theirs = stored(published ?? EMPTY);
  return DIFF_PIECES.filter((piece) => canonical(mine[piece]) !== canonical(theirs[piece]));
}
