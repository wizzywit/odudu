import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { SigningIn } from '#/features/session/view/SigningIn.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

it('names the tenant whose sign-in the window is leaving for', () => {
  render(<SigningIn tenant="acme" ended={false} />);
  expect(screen.getByRole('heading', { level: 1, name: 'Signing in' })).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent("Taking you to acme's sign-in…");
});

it('says the session ended and that unsaved changes come back', () => {
  render(<SigningIn tenant="acme" ended />);
  expect(screen.getByRole('heading', { level: 1, name: 'Your session ended' })).toBeVisible();
  expect(screen.getByText(/come back after you sign in/u)).toBeVisible();
});

it('says the console is opening when no tenant is known yet', () => {
  render(<SigningIn tenant={null} ended={false} />);
  expect(screen.getByRole('status')).toHaveTextContent('Opening the console…');
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => <SigningIn tenant="acme" ended />)).toEqual({
    light: [],
    dark: [],
  });
});
