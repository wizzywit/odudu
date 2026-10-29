export type CodeLanguage = 'css' | 'template';

export type TokenKind =
  | 'plain'
  | 'comment'
  | 'keyword'
  | 'selector'
  | 'property'
  | 'value'
  | 'string'
  | 'number'
  | 'function'
  | 'tag'
  | 'attribute'
  | 'part';

export interface CodeToken {
  kind: TokenKind;
  text: string;
}

// Longer text is shown as typed, without colour: colouring is a pass over
// every character and a span per token on every keystroke, and nothing a
// theme needs comes near this size.
export const HIGHLIGHT_LIMIT = 40_000;

// Said beside a field whose text is past the limit.
export const PLAIN_NOTE = 'Colour and line numbers are off for text this long.';

// Narrow, a long line can be wrapped to the screen instead of scrolled across.
export const WRAP_LABEL = 'Wrap lines';

export interface Highlighted {
  tokens: readonly CodeToken[];
  // True when the text was too long to colour and is shown as typed.
  plain: boolean;
}

export interface Collector {
  push: (kind: TokenKind, from: number, to: number) => void;
  tokens: () => CodeToken[];
}

// Tokens are kept as ranges of the source and cut once at the end, so a
// long run of one kind costs no more than a short one. Adjacent tokens of
// one kind are one token.
export function collector(source: string): Collector {
  const kinds: TokenKind[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  return {
    push: (kind, from, to) => {
      if (to <= from) return;
      const last = kinds.length - 1;
      if (last >= 0 && kinds[last] === kind && ends[last] === from) {
        ends[last] = to;
        return;
      }
      kinds.push(kind);
      starts.push(from);
      ends.push(to);
    },
    tokens: () =>
      kinds.map((kind, index) => ({
        kind,
        text: source.slice(starts[index], ends[index]),
      })),
  };
}

// The index of the first character from `from` that `stop` accepts, or the
// end; `stop` is also told where it is looking.
export function scanUntil(
  source: string,
  from: number,
  stop: (code: number, index: number) => boolean,
): number {
  let index = from;
  while (index < source.length && !stop(source.charCodeAt(index), index)) index += 1;
  return index;
}

// The index after the run of characters from `from` that `test` accepts.
export function scanWhile(source: string, from: number, test: (code: number) => boolean): number {
  return scanUntil(source, from, (code) => !test(code));
}

export function isWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0c;
}

export function isLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

export function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

export function isQuote(code: number): boolean {
  return code === 0x22 || code === 0x27;
}

export function plainTokens(source: string): CodeToken[] {
  return source === '' ? [] : [{ kind: 'plain', text: source }];
}
