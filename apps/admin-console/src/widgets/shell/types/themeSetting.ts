import type { ThemeChoice } from '#/shared/lib/services/theme';

export interface ThemeSetting {
  choice: ThemeChoice;
  options: readonly { id: ThemeChoice; label: string }[];
  parse: (value: string) => ThemeChoice | undefined;
  choose: (choice: ThemeChoice) => void;
}
