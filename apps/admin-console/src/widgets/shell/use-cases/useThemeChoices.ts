import { THEME_CHOICES, themeChoice } from '#/shared/services/theme';

export function useThemeChoices() {
  return { choices: THEME_CHOICES, themeChoice };
}
