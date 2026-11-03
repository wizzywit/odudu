import type { ReactNode } from 'react';
import {
  useHighlight,
  type Highlighted,
} from '@site/src/features/code-block/use-cases/useHighlight';

interface Props {
  code: string;
  language: string;
  children: (render: Highlighted) => ReactNode;
}

// The code block theme's highlighter, drawing the lines the build wrote and
// plain text otherwise, so the browser carries no tokenizer.
export function Highlight({ code, language, children }: Props): ReactNode {
  return children(useHighlight(code, language));
}
