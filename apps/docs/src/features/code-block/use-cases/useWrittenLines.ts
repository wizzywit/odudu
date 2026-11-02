import { createContext, useContext } from 'react';
import type { CodeLine } from '@site/src/features/code-block/services/lines';

const WrittenLines = createContext<CodeLine[] | undefined>(undefined);

// A code block provides the lines its build highlighted above its content.
export const WrittenLinesProvider = WrittenLines.Provider;

export function useWrittenLines(): CodeLine[] | undefined {
  return useContext(WrittenLines);
}
