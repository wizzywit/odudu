import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { MinimalFailure } from '#/widgets/failure/ui/MinimalFailure';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

const REPORT = { id: 'ABCD2345', route: '/', time: '2026-10-22T09:30:15.123Z' };

it('says what happened, names the id, and offers a link that loads the page again', () => {
  render(<MinimalFailure report={REPORT} />);
  expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeVisible();
  expect(screen.getByText('Error ID: ABCD2345')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Reload the console' })).toHaveAttribute(
    'href',
    window.location.href,
  );
});

it('names no id when none could be made', () => {
  render(<MinimalFailure report={null} />);
  expect(screen.queryByText(/Error ID/u)).toBeNull();
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => <MinimalFailure report={REPORT} />)).toEqual({
    light: [],
    dark: [],
  });
});
