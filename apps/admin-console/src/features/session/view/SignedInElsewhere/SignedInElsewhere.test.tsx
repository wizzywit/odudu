import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { SignedInElsewhere } from '#/features/session/view/SignedInElsewhere';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };

it('says who is signed in where, and offers the way back beside the sign-in', async () => {
  const onSignIn = vi.fn();
  render(<SignedInElsewhere principal={GRACE} tenant="globex" onSignIn={onSignIn} />);
  expect(screen.getByRole('heading', { level: 1, name: 'Signed in to acme' })).toBeVisible();
  expect(screen.getByText(/signed in to/u)).toHaveTextContent("You're signed in to acme as grace.");
  expect(screen.getByRole('link', { name: 'Back to acme' })).toHaveAttribute(
    'href',
    '/console/acme',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Sign in to globex' }));
  expect(onSignIn).toHaveBeenCalledOnce();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <SignedInElsewhere principal={GRACE} tenant="globex" onSignIn={() => undefined} />
    )),
  ).toEqual({ light: [], dark: [] });
});
