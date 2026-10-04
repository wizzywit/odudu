import { createContext, useContext } from 'react';
import type { ThemeChoice } from '#/shared/service/theme.ts';

export interface Theme {
  choice: ThemeChoice;
  choose: (choice: ThemeChoice) => void;
}

export const ThemeContext = createContext<Theme | null>(null);

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (theme === null) throw new Error('useTheme needs a ThemeContext above it');
  return theme;
}
