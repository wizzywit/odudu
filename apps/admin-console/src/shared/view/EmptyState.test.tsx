import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { EmptyState } from '#/shared/view/EmptyState.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

it('tells nothing yet, nothing matches and failed to load apart in words', () => {
  render(
    <>
      <EmptyState variant="nothing-yet" title="No clients yet" />
      <EmptyState variant="nothing-matches" title="No clients match" />
      <EmptyState variant="failed" title="Clients could not be loaded" />
    </>,
  );
  const kickers = ['Nothing yet', 'No matches', 'Failed to load'].map((text) =>
    screen.getByText(text),
  );
  expect(new Set(kickers.map((k) => k.closest('section')))).toHaveProperty('size', 3);
  expect(screen.getByRole('heading', { level: 2, name: 'No clients yet' })).toBeInTheDocument();
});

it('announces a failure, and only a failure', () => {
  render(
    <>
      <EmptyState variant="nothing-yet" title="No clients yet" />
      <EmptyState variant="failed" title="Clients could not be loaded">
        The server did not answer.
      </EmptyState>
    </>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Clients could not be loaded');
  expect(screen.getAllByRole('alert')).toHaveLength(1);
});

it('offers its action', () => {
  render(
    <EmptyState
      variant="nothing-matches"
      title="No clients match"
      action={<button type="button">Clear filters</button>}
    />,
  );
  expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <>
        <EmptyState variant="nothing-yet" title="No clients yet">
          Register one to get started.
        </EmptyState>
        <EmptyState variant="nothing-matches" title="No clients match" />
        <EmptyState variant="failed" title="Clients could not be loaded" />
      </>
    )),
  ).toEqual({ light: [], dark: [] });
});
