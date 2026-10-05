import type { ThemeChoice } from '#/shared/service/theme.ts';

export const THEME_CHOICES: readonly { id: ThemeChoice; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

export function themeChoice(value: string): ThemeChoice | undefined {
  return THEME_CHOICES.find((c) => c.id === value)?.id;
}
