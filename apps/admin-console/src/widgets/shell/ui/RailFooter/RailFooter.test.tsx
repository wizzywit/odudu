import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { RailFooter } from '#/widgets/shell/ui/RailFooter';
import type { ThemeSetting } from '#/widgets/shell/types/themeSetting';
import { THEME_CHOICES, themeChoice } from '#/shared/lib/services/theme';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

const THEME: ThemeSetting = {
  choice: 'system',
  options: THEME_CHOICES,
  parse: themeChoice,
  choose: () => undefined,
};

function footer(from: string | null, onSignOut = () => undefined) {
  return (
    <RailFooter
      username="grace"
      from={from}
      switchHref="/console/?choose"
      theme={THEME}
      onSignOut={onSignOut}
    />
  );
}

it('names who is signed in, and where from when that is another tenant', () => {
  const { rerender } = render(footer(null));
  expect(screen.getByText(/Signed in as/u)).toHaveTextContent('Signed in as grace');
  rerender(footer('system'));
  expect(screen.getByText(/Signed in as/u)).toHaveTextContent('Signed in as grace from system');
});

it('offers a tenant switch by link and a sign-out by button', async () => {
  const onSignOut = vi.fn();
  render(footer('acme', onSignOut));
  expect(screen.getByRole('link', { name: 'Switch tenant' })).toHaveAttribute(
    'href',
    '/console/?choose',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(onSignOut).toHaveBeenCalledOnce();
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => footer('system'))).toEqual({ light: [], dark: [] });
});
