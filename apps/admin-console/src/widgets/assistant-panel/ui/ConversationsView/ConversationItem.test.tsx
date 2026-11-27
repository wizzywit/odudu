import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GridList } from 'react-aria-components';
import { expect, it, vi } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import type { ConversationRow } from '#/widgets/assistant-panel/types/conversations';
import { ConversationItem } from '#/widgets/assistant-panel/ui/ConversationsView/ConversationItem';

const NOW = new Date('2026-11-26T12:00:00.000Z');

const ROW: ConversationRow = {
  id: 'a',
  title: 'How many clients?',
  lastActiveAt: '2026-11-26T11:00:00.000Z',
  mode: 'ask',
  modeLabel: 'Ask',
  tenant: null,
  archived: false,
  reported: false,
  menuLabel: 'Actions for How many clients?',
};

function handlers() {
  return {
    onOpen: vi.fn(),
    onArchive: vi.fn(),
    onRestore: vi.fn(),
    onExport: vi.fn(),
    onAskDelete: vi.fn(),
  };
}

function item(row: ConversationRow, given = handlers(), extra: { current?: boolean } = {}) {
  return (
    <GridList aria-label="Conversations" selectionMode="none">
      <ConversationItem
        row={row}
        current={extra.current ?? false}
        leaving={false}
        now={NOW}
        handlers={given}
        words={PANEL_WORDING}
      />
    </GridList>
  );
}

it('shows the title, when it was last active and its mode, and the tenant it is about', () => {
  render(item({ ...ROW, tenant: 'demo', mode: 'act', modeLabel: 'Act' }));
  const row = screen.getByRole('row', { name: /How many clients/u });
  expect(within(row).getByText('1 hour ago')).toBeInTheDocument();
  expect(within(row).getByText('Act')).toBeInTheDocument();
  expect(within(row).getByText('demo')).toHaveAttribute('title', 'demo');
});

it('marks the conversation that is open, and one that was reported', () => {
  render(item({ ...ROW, reported: true }, handlers(), { current: true }));
  expect(screen.getByRole('row', { name: /How many clients/u })).toHaveAttribute(
    'data-current',
    'true',
  );
  expect(screen.getByText('Reported')).toBeInTheDocument();
});

it('offers Archive for an open conversation and Restore for a hidden one', async () => {
  const user = userEvent.setup();
  const given = handlers();
  const { unmount } = render(item(ROW, given));
  await user.click(screen.getByRole('button', { name: ROW.menuLabel }));
  expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Restore' })).toBeNull();
  await user.click(screen.getByRole('menuitem', { name: 'Archive' }));
  expect(given.onArchive).toHaveBeenCalledWith(ROW);
  unmount();
  const hidden = { ...ROW, archived: true };
  render(item(hidden, given));
  await user.click(screen.getByRole('button', { name: ROW.menuLabel }));
  await user.click(screen.getByRole('menuitem', { name: 'Restore' }));
  expect(given.onRestore).toHaveBeenCalledWith(hidden);
});

it('exports in either format and asks before a delete, which a reported one cannot', async () => {
  const user = userEvent.setup();
  const given = handlers();
  render(item(ROW, given));
  await user.click(screen.getByRole('button', { name: ROW.menuLabel }));
  await user.click(screen.getByRole('menuitem', { name: 'Export as JSON' }));
  expect(given.onExport).toHaveBeenCalledWith(ROW, 'json');
  await user.click(screen.getByRole('button', { name: ROW.menuLabel }));
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
  expect(given.onAskDelete).toHaveBeenCalledWith(ROW);
});

it('has no accessibility violations in either theme', async () => {
  expect(await axeInBothThemes(() => item({ ...ROW, tenant: 'demo' }))).toEqual({
    light: [],
    dark: [],
  });
});
