import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import type {
  ConversationRow,
  ConversationSection,
  ConversationsState,
} from '#/widgets/assistant-panel/types/conversations';
import { ConversationsView } from '#/widgets/assistant-panel/ui/ConversationsView';

function row(id: string, title: string, extra: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id,
    title,
    lastActiveAt: '2026-11-26T11:00:00.000Z',
    mode: 'ask',
    modeLabel: 'Ask',
    tenant: null,
    archived: false,
    reported: false,
    menuLabel: `Actions for ${title}`,
    ...extra,
  };
}

function section(rows: ConversationRow[], extra: Partial<ConversationSection> = {}) {
  return {
    status: 'ready',
    rows,
    more: false,
    loadingMore: false,
    moreFailed: false,
    limited: false,
    loadMore: vi.fn(),
    retry: vi.fn(),
    ...extra,
  } satisfies ConversationSection;
}

function state(extra: Partial<ConversationsState> = {}): ConversationsState {
  const open = [row('a', 'How many clients?'), row('b', 'Roles')];
  return {
    open: true,
    show: vi.fn(),
    hide: vi.fn(),
    currentId: 'a',
    groups: [{ id: 'today', label: 'Today', rows: open }],
    opened: section(open),
    archived: section([]),
    archivedLabel: 'Archived (0)',
    now: new Date('2026-11-26T12:00:00.000Z'),
    pending: null,
    onOpen: vi.fn(),
    onNew: vi.fn(),
    onStopAndSwitch: vi.fn(),
    onKeepWaiting: vi.fn(),
    onArchive: vi.fn(),
    onRestore: vi.fn(),
    onRestoreCurrent: vi.fn(),
    onExport: vi.fn(),
    undo: null,
    leaving: null,
    onUndo: vi.fn(),
    deleting: null,
    deleteBusy: false,
    deleteProblem: null,
    onAskDelete: vi.fn(),
    onConfirmDelete: vi.fn(),
    onCancelDelete: vi.fn(),
    ...extra,
  };
}

function view(given: ConversationsState) {
  return <ConversationsView state={given} words={PANEL_WORDING} />;
}

it('lists the conversations under their day, with the open one marked', () => {
  render(view(state()));
  const grid = screen.getByRole('grid', { name: 'Conversations' });
  expect(within(grid).getByText('Today')).toBeInTheDocument();
  expect(within(grid).getByRole('row', { name: /How many clients/u })).toHaveAttribute(
    'data-current',
    'true',
  );
  expect(within(grid).getByRole('row', { name: /Roles/u })).not.toHaveAttribute('data-current');
});

it('goes back, and starts a new conversation, from its head', async () => {
  const user = userEvent.setup();
  const given = state();
  render(view(given));
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(given.hide).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'New conversation' }));
  expect(given.onNew).toHaveBeenCalledTimes(1);
});

it('is taken out of the page and the keyboard while the chat shows', () => {
  render(view(state({ open: false })));
  expect(screen.queryByRole('heading', { name: 'Your conversations' })).toBeNull();
});

it('shows a skeleton while it loads, a failure with a retry, and an empty state', async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    view(state({ groups: [], opened: section([], { status: 'loading' }) })),
  );
  expect(screen.getByText('Loading your conversations')).toBeInTheDocument();
  const retry = vi.fn();
  rerender(view(state({ groups: [], opened: section([], { status: 'failed', retry }) })));
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledTimes(1);
  rerender(view(state({ groups: [] })));
  expect(screen.getByText('No conversations yet')).toBeInTheDocument();
});

it('keeps archived conversations under a disclosure, and says when they could not be loaded', async () => {
  const user = userEvent.setup();
  const hidden = row('z', 'Hidden', { archived: true });
  const { rerender } = render(
    view(state({ archived: section([hidden]), archivedLabel: 'Archived (1)' })),
  );
  const summary = screen.getByText('Archived (1)');
  expect(screen.getByRole('grid', { name: 'Archived', hidden: true })).toBeInTheDocument();
  await user.click(summary);
  expect(screen.getByRole('row', { name: /Hidden/u })).toBeVisible();
  const retry = vi.fn();
  rerender(view(state({ archived: section([], { status: 'failed', retry }) })));
  expect(screen.getByText('Archived conversations could not be loaded.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledTimes(1);
});

it('loads more, and says when a further page could not be loaded', async () => {
  const user = userEvent.setup();
  const loadMore = vi.fn();
  render(
    view(state({ opened: section([row('a', 'One')], { more: true, moreFailed: true, loadMore }) })),
  );
  expect(screen.getByRole('alert')).toHaveTextContent('More conversations could not be loaded');
  await user.click(screen.getByRole('button', { name: 'Load more conversations' }));
  expect(loadMore).toHaveBeenCalledTimes(1);
});

it('asks whether to stop a running answer before it switches, in a note over the foot of the list', async () => {
  const user = userEvent.setup();
  const given = state({ pending: { id: 'b', archived: false } });
  const { rerender } = render(view(state()));
  rerender(view(given));
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent(
    'An answer is still running. Stop it to switch, or keep waiting.',
  );
  expect(within(alert).getByRole('button', { name: 'Stop and switch' })).toHaveFocus();
  await user.click(within(alert).getByRole('button', { name: 'Stop and switch' }));
  expect(given.onStopAndSwitch).toHaveBeenCalledTimes(1);
  await user.click(within(alert).getByRole('button', { name: 'Keep waiting' }));
  expect(given.onKeepWaiting).toHaveBeenCalledTimes(1);
});

it('says a conversation was archived, in a status region that is always there, and offers Undo', async () => {
  const user = userEvent.setup();
  const given = state();
  const { rerender } = render(view(given));
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
  const archived = state({ undo: row('a', 'How many clients?') });
  rerender(view(archived));
  expect(screen.getByRole('status')).toHaveTextContent('Archived.');
  await user.click(screen.getByRole('button', { name: 'Undo' }));
  expect(archived.onUndo).toHaveBeenCalledTimes(1);
});

it('asks before it deletes, naming the conversation, and says what was refused', async () => {
  const user = userEvent.setup();
  const given = state({
    deleting: row('a', 'How many clients?'),
    deleteProblem: 'This conversation was reported and is kept for review.',
  });
  render(view(given));
  const dialog = screen.getByRole('alertdialog');
  expect(dialog).toHaveTextContent('How many clients?');
  expect(dialog).toHaveTextContent('record that a conversation was deleted is kept');
  expect(within(dialog).getByRole('alert')).toHaveTextContent('kept for review');
  await user.click(within(dialog).getByRole('button', { name: 'Delete conversation' }));
  expect(given.onConfirmDelete).toHaveBeenCalledTimes(1);
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(given.onCancelDelete).toHaveBeenCalledTimes(1);
});

it('has no accessibility violations in either theme', async () => {
  expect(
    await axeInBothThemes(() =>
      view(
        state({
          archived: section([row('z', 'Hidden', { archived: true })]),
          archivedLabel: 'Archived (1)',
          pending: { id: 'b', archived: false },
          undo: row('a', 'How many clients?'),
        }),
      ),
    ),
  ).toEqual({ light: [], dark: [] });
});
