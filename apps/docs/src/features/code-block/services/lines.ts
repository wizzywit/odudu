export interface CodeToken {
  types: string[];
  content: string;
}

export type CodeLine = CodeToken[];

export const TOKENS_ATTRIBUTE = 'data-tokens';

function isPiece(value: unknown): value is string | [string, string] {
  return (
    typeof value === 'string' ||
    (Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      typeof value[1] === 'string')
  );
}

function tokenOf(piece: string | [string, string]): CodeToken {
  return typeof piece === 'string'
    ? { types: ['plain'], content: piece }
    : { types: piece[0].split(' '), content: piece[1] };
}

// The highlighted lines a build wrote into a block, or nothing when there are
// none or they are not lines.
export function parseLines(attribute: unknown): CodeLine[] | undefined {
  if (typeof attribute !== 'string') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(attribute);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const lines: CodeLine[] = [];
  for (const line of parsed as unknown[]) {
    if (!Array.isArray(line) || !line.every(isPiece)) return undefined;
    lines.push(line.map(tokenOf));
  }
  return lines;
}

export function plainLines(code: string): CodeLine[] {
  return code.split('\n').map((text) => [{ types: ['plain'], content: text }]);
}

// What the build wrote is the code it highlighted; code that no longer matches
// it is shown plain rather than wrongly coloured.
export function linesFor(code: string, written: CodeLine[] | undefined): CodeLine[] {
  const text = written?.map((line) => line.map((token) => token.content).join('')).join('\n');
  return written !== undefined && text === code ? written : plainLines(code);
}

export function tokenClass(types: string[]): string | undefined {
  const names = types.filter((type) => type !== 'plain').map((type) => `tok-${type}`);
  return names.length === 0 ? undefined : names.join(' ');
}
