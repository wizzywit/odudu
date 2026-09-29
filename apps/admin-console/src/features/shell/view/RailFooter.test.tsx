import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { RailFooter } from '#/features/shell/view/RailFooter.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

function footer(signedInTo: string, onSignOut = () => undefined) {
  return (
    <RailFooter
      username="grace"
      signedInTo={signedInTo}
      tenant="acme"
      switchHref="/console/?choose"
      theme="system"
      onChooseTheme={() => undefined}
      onSignOut={onSignOut}
    />
  );
}

it('names who is signed in, and where from when that is another tenant', () => {
  const { rerender } = render(footer('acme'));
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
