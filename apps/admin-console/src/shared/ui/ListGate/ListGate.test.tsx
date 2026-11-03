import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { ListStatus } from '#/shared/lib/services/resourceList';
import { ListGate } from '#/shared/ui/ListGate';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

function gate(
  status: ListStatus,
  { refuses = true, unchanged = false } = {},
  retry: () => void = vi.fn(),
) {
  return (
    <ListGate
      list={{ status, retry }}
      loading={<p>Loading sessions</p>}
      {...(refuses ? { refused: { capability: 'view-sessions', noun: 'Sessions' } } : {})}
      failed="The sessions could not be loaded"
      unchanged={unchanged}
    >
      {() => <p>the rows</p>}
    </ListGate>
  );
}

it('draws its placeholder while the list loads, and the rows once it is ready', () => {
  const { rerender } = render(gate('loading'));
  expect(screen.getByText('Loading sessions')).toBeVisible();
  expect(screen.queryByText('the rows')).toBeNull();
  rerender(gate('ready'));
  expect(screen.getByText('the rows')).toBeVisible();
  expect(screen.queryByText('Loading sessions')).toBeNull();
});

it('names the capability a refused list needs', () => {
  render(gate('refused'));
  expect(screen.getByText(/Sessions needs the/u)).toHaveTextContent('view-sessions');
  expect(screen.queryByText('the rows')).toBeNull();
});

it('reads a refusal as a failure when no capability is named', () => {
  render(gate('refused', { refuses: false }));
  expect(screen.getByText('The sessions could not be loaded')).toBeVisible();
});

it('says a failed list could not be loaded, asks again, and can say nothing was changed', async () => {
  const user = userEvent.setup();
  const retry = vi.fn();
  const { rerender } = render(gate('failed', {}, retry));
  expect(screen.getByText('The sessions could not be loaded')).toBeVisible();
  expect(screen.queryByText(/Nothing was changed/u)).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledOnce();
  rerender(gate('failed', { unchanged: true }, retry));
  expect(screen.getByText(/Nothing was changed/u)).toBeVisible();
});

it.each(['loading', 'refused', 'failed', 'ready'] as const)(
  'has no accessibility violations in either theme while %s',
  async (status) => {
    expect(await axeInBothThemes(() => gate(status))).toEqual({ light: [], dark: [] });
  },
);
