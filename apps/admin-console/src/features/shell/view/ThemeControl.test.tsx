import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ThemeControl } from '#/features/shell/view/ThemeControl.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

it('offers system, light and dark, with the current choice checked', async () => {
  const onChoose = vi.fn();
  render(<ThemeControl choice="system" onChoose={onChoose} />);
  const group = screen.getByRole('radiogroup', { name: 'Theme' });
  expect(group).toBeVisible();
  expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
  await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
  expect(onChoose).toHaveBeenCalledWith('dark');
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => <ThemeControl choice="light" onChoose={() => undefined} />),
  ).toEqual({ light: [], dark: [] });
});
