import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { SignIn } from '#/features/session/view/SignIn.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

const check = (tenant: string) => (tenant === 'acme' ? undefined : 'Not a tenant name.');

it('asks which tenant, and refuses a name the check refuses under its field', async () => {
  const user = userEvent.setup();
  const onSignIn = vi.fn();
  render(<SignIn remembered={null} onSignIn={onSignIn} check={check} />);
  const field = screen.getByRole('textbox', { name: 'Which tenant do you administer?' });
  await user.type(field, 'Acme');
  await user.click(screen.getByRole('button', { name: 'Continue to sign-in' }));
  expect(field).toHaveAccessibleDescription(/Not a tenant name\./u);
  expect(onSignIn).not.toHaveBeenCalled();

  await user.clear(field);
  await user.type(field, 'acme');
  await user.click(screen.getByRole('button', { name: 'Continue to sign-in' }));
  expect(onSignIn).toHaveBeenCalledWith('acme');
});

it('offers the remembered tenant first, and the question on request', async () => {
  const user = userEvent.setup();
  const onSignIn = vi.fn();
  render(<SignIn remembered="acme" onSignIn={onSignIn} check={check} />);
  await user.click(screen.getByRole('button', { name: 'Sign in to acme' }));
  expect(onSignIn).toHaveBeenCalledWith('acme');
  await user.click(screen.getByRole('button', { name: 'A different tenant' }));
  expect(screen.getByRole('textbox', { name: 'Which tenant do you administer?' })).toBeVisible();
});

it('lets a system administrator enter a tenant rather than sign in to it', async () => {
  const user = userEvent.setup();
  render(<SignIn remembered={null} enters onSignIn={() => undefined} check={check} />);
  expect(screen.getByRole('button', { name: 'Enter tenant' })).toBeVisible();
  await user.type(screen.getByRole('textbox'), 'acme');
  expect(screen.getByRole('button', { name: 'Enter acme' })).toBeVisible();
});

it('passes axe in both themes, asking and remembering', async () => {
  for (const remembered of [null, 'acme']) {
    expect(
      await axeInBothThemes(() => (
        <SignIn remembered={remembered} onSignIn={() => undefined} check={check} />
      )),
    ).toEqual({ light: [], dark: [] });
  }
});
