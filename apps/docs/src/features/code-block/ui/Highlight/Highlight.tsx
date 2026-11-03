import type { ReactNode } from 'react';
import { classNames } from '@site/src/shared/ui/classNames';
import {
  linesFor,
  tokenClass,
  type CodeLine,
  type CodeToken,
} from '@site/src/features/code-block/services/lines';
import { useWrittenLines } from '@site/src/features/code-block/use-cases/useWrittenLines';

interface Render {
  className: string;
  style: Record<string, never>;
  tokens: CodeLine[];
  getLineProps: (input: { line: CodeLine; className?: string }) => { className: string };
  getTokenProps: (input: { token: CodeToken }) => {
    className: string | undefined;
    children: string;
  };
}

interface Props {
  code: string;
  language: string;
  children: (render: Render) => ReactNode;
}

// The code block theme's highlighter, drawing the lines the build wrote and
// plain text otherwise, so the browser carries no tokenizer.
export function Highlight({ code, language, children }: Props): ReactNode {
  const tokens = linesFor(code, useWrittenLines());
  return children({
    className: `prism-code language-${language}`,
    style: {},
    tokens,
    getLineProps: ({ className }) => ({ className: classNames('token-line', className) }),
    getTokenProps: ({ token }) => ({
      className: tokenClass(token.types),
      children: token.content,
    }),
  });
}
