import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { OVERVIEW_WORDS } from '#/pages/overview/services/overviewWords';
import type { AttentionState } from '#/pages/overview/services/state';
import { AttentionPanel } from '#/pages/overview/ui/AttentionPanel';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

function state(overrides: Partial<AttentionState> = {}): AttentionState {
  return {
    status: 'ready',
    clear: false,
    items: [
      {
        id: 'smtp',
        area: 'email',
        title: 'No mail relay',
        detail: 'Mail is only logged.',
        href: '/console/acme/email',
        linkLabel: 'Open Email',
      },
    ],
    unchecked: [],
    failed: false,
    retry: vi.fn(),
    ...overrides,
  };
}

it('lists each item with a link to the page that fixes it', () => {
  render(<AttentionPanel words={OVERVIEW_WORDS.attention} attention={state()} />);
  const list = screen.getByRole('list', { name: 'Needs attention' });
  const item = within(list).getByRole('listitem');
  expect(item).toHaveTextContent('No mail relay');
  expect(item).toHaveTextContent('Mail is only logged.');
  expect(within(item).getByRole('link', { name: 'Open Email' })).toHaveAttribute(
    'href',
    '/console/acme/email',
  );
});

it('says when nothing needs attention', () => {
  render(
    <AttentionPanel
      words={OVERVIEW_WORDS.attention}
      attention={state({ items: [], clear: true })}
    />,
  );
  const line = screen.getByText('Nothing needs attention.');
  expect(line).toBeVisible();
  expect(line.closest('p')?.querySelector('[aria-hidden="true"]')).toHaveTextContent('✓');
});

it('says it is still checking', () => {
  render(
    <AttentionPanel
      words={OVERVIEW_WORDS.attention}
      attention={state({ status: 'checking', items: [] })}
    />,
  );
  expect(screen.getByRole('status')).toHaveTextContent('Checking what needs attention');
  expect(screen.getByRole('status').querySelector('[data-shape="list"]')).not.toBeNull();
  expect(screen.queryByText('Nothing needs attention.')).toBeNull();
});

it('names the capabilities a check could not run without', () => {
  render(
    <AttentionPanel
      words={OVERVIEW_WORDS.attention}
      attention={state({ items: [], unchecked: ['manage-keys', 'manage-clients'] })}
    />,
  );
  expect(screen.getByRole('note')).toHaveTextContent(
    'Some checks need a capability you do not hold: manage-keys, manage-clients.',
  );
  expect(screen.queryByText('Nothing needs attention.')).toBeNull();
});

it('offers to check again when a read failed', async () => {
  const user = userEvent.setup();
  const retry = vi.fn();
  render(
    <AttentionPanel
      words={OVERVIEW_WORDS.attention}
      attention={state({ items: [], failed: true, retry })}
    />,
  );
  expect(screen.getByText('Some checks could not run.')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Check again' }));
  expect(retry).toHaveBeenCalledOnce();
});

it('passes axe in both themes', async () => {
  for (const attention of [
    state(),
    state({ items: [], unchecked: ['manage-keys'], failed: true }),
    state({ status: 'checking' }),
  ]) {
    expect(
      await axeInBothThemes(() => (
        <AttentionPanel words={OVERVIEW_WORDS.attention} attention={attention} />
      )),
    ).toEqual({
      light: [],
      dark: [],
    });
  }
});
