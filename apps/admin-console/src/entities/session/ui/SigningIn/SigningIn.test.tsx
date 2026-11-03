import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { SigningIn } from '#/entities/session/ui/SigningIn';
import { signingInWords } from '#/entities/session/services/sessionStatusText';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

it('names the tenant whose sign-in the window is leaving for', () => {
  render(<SigningIn words={signingInWords('acme', false)} ended={false} />);
  expect(screen.getByRole('heading', { level: 1, name: 'Signing in' })).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent("Taking you to acme's sign-in…");
});

it('says the session ended and that unsaved changes come back', () => {
  render(<SigningIn words={signingInWords('acme', true)} ended />);
  expect(screen.getByRole('heading', { level: 1, name: 'Your session ended' })).toBeVisible();
  expect(screen.getByText(/come back after you sign in/u)).toBeVisible();
});

it('says the console is opening when no tenant is known yet', () => {
  render(<SigningIn words={signingInWords(null, false)} ended={false} />);
  expect(screen.getByRole('status')).toHaveTextContent('Opening the console…');
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => <SigningIn words={signingInWords('acme', true)} ended />),
  ).toEqual({
    light: [],
    dark: [],
  });
});
