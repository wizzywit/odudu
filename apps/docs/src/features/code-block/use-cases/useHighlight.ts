import {
  blockClass,
  linesFor,
  lineProps,
  tokenProps,
  type CodeLine,
  type CodeToken,
} from '@site/src/features/code-block/services/lines';
import { useWrittenLines } from '@site/src/features/code-block/use-cases/useWrittenLines';

export interface Highlighted {
  className: string;
  style: Record<string, never>;
  tokens: CodeLine[];
  getLineProps: (input: { line: CodeLine; className?: string }) => { className: string };
  getTokenProps: (input: { token: CodeToken }) => {
    className: string | undefined;
    children: string;
  };
}

// The lines the build wrote for a block, and plain text where they no longer match.
export function useHighlight(code: string, language: string): Highlighted {
  const tokens = linesFor(code, useWrittenLines());
  return {
    className: blockClass(language),
    style: {},
    tokens,
    getLineProps: ({ className }) => lineProps(className),
    getTokenProps: ({ token }) => tokenProps(token),
  };
}
