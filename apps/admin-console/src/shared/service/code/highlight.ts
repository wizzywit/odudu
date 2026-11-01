import { cssTokens } from '#/shared/service/code/css';
import { templateTokens } from '#/shared/service/code/template';
import {
  HIGHLIGHT_LIMIT,
  plainTokens,
  type CodeLanguage,
  type CodeToken,
  type Highlighted,
} from '#/shared/service/code/tokens';

// A textarea reads every line break as \n, so the coloured copy does too.
export function normalisedBreaks(text: string): string {
  return text.replace(/\r\n?/gu, '\n');
}

export function highlight(language: CodeLanguage, text: string): Highlighted {
  const source = normalisedBreaks(text);
  if (source.length > HIGHLIGHT_LIMIT) return { tokens: plainTokens(source), plain: true };
  return {
    tokens: language === 'css' ? cssTokens(source) : templateTokens(source),
    plain: false,
  };
}

// The tokens cut at each line break, which belongs to neither line. A token
// that spans lines (a comment) continues on the next line under its kind.
export function tokensByLine(tokens: readonly CodeToken[]): CodeToken[][] {
  const lines: CodeToken[][] = [[]];
  for (const token of tokens) {
    const parts = token.text.split('\n');
    parts.forEach((text, index) => {
      if (index > 0) lines.push([]);
      if (text !== '') lines[lines.length - 1]?.push({ kind: token.kind, text });
    });
  }
  return lines;
}

export function lineCount(source: string): number {
  let count = 1;
  let at = source.indexOf('\n');
  while (at !== -1) {
    count += 1;
    at = source.indexOf('\n', at + 1);
  }
  return count;
}
