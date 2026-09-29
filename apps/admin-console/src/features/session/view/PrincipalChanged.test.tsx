import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { PrincipalChanged } from '#/features/session/view/PrincipalChanged.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };
const ROOT = { tenant: 'system', subjectId: 's0', username: 'root' };

function page(onCarryOn = () => undefined, onSignInAgain = () => undefined) {
  return (
    <PrincipalChanged was={GRACE} now={ROOT} onCarryOn={onCarryOn} onSignInAgain={onSignInAgain} />
  );
}

it('says who the browser is signed in as now, and what continuing does to the kept edits', () => {
  render(page());
  expect(
    screen.getByRole('heading', { level: 1, name: 'Signed in as somebody else' }),
  ).toBeVisible();
  expect(screen.getByText(/now signed in as/u)).toHaveTextContent(
    'This browser is now signed in as root in system.',
  );
  expect(screen.getByText(/are kept in this tab/u)).toHaveTextContent(
    'Unsaved changes made as grace are kept in this tab for when grace signs in again. Continuing as root discards them.',
  );
});

it('offers both ways on, neither taken until pressed', async () => {
  const user = userEvent.setup();
  const onCarryOn = vi.fn();
  const onSignInAgain = vi.fn();
  render(page(onCarryOn, onSignInAgain));
  expect(onCarryOn).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Sign in as grace again' }));
  expect(onSignInAgain).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: 'Continue as root' }));
  expect(onCarryOn).toHaveBeenCalledOnce();
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => page())).toEqual({ light: [], dark: [] });
});
