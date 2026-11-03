import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ThemeControl } from '#/widgets/shell/ui/ThemeControl';
import type { ThemeSetting } from '#/widgets/shell/types/themeSetting';
import { THEME_CHOICES, themeChoice, type ThemeChoice } from '#/shared/lib/services/theme';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

function setting(choice: ThemeChoice, choose: (choice: ThemeChoice) => void): ThemeSetting {
  return { choice, options: THEME_CHOICES, parse: themeChoice, choose };
}

it('offers system, light and dark, with the current choice checked', async () => {
  const onChoose = vi.fn();
  render(<ThemeControl theme={setting('system', onChoose)} />);
  const group = screen.getByRole('radiogroup', { name: 'Theme' });
  expect(group).toBeVisible();
  expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
  await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
  expect(onChoose).toHaveBeenCalledWith('dark');
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => <ThemeControl theme={setting('light', () => undefined)} />),
  ).toEqual({ light: [], dark: [] });
});
