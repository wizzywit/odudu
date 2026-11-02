import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { SessionStatus } from '#/features/session/ui/SessionStatus';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

it('is a main landmark with the title as its heading', () => {
  render(
    <SessionStatus title="Signing in">
      <p>Taking you there…</p>
    </SessionStatus>,
  );
  expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  expect(screen.getByRole('heading', { level: 1, name: 'Signing in' })).toBeVisible();
  expect(screen.getByText('Taking you there…')).toBeVisible();
});

it('names the console beside the staff mark', () => {
  render(
    <SessionStatus title="Signing in">
      <p>Taking you there…</p>
    </SessionStatus>,
  );
  const main = screen.getByRole('main');
  expect(main.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  expect(screen.getByText('Odudu console')).toBeVisible();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <SessionStatus title="Signing in">
        <p>Taking you there…</p>
      </SessionStatus>
    )),
  ).toEqual({ light: [], dark: [] });
});
