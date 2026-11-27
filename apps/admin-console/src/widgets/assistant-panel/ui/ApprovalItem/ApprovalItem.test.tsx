import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import type { Entry } from '#/widgets/assistant-panel/types/approvals';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import type { ApprovalCard } from '#/widgets/assistant-panel/types/approvals';
import { ApprovalItem } from '#/widgets/assistant-panel/ui/ApprovalItem';

// The browser's clock is ten minutes behind the server's.
const BROWSER_NOW = Date.parse('2026-11-26T05:30:00.000Z');
const OFFSET = 600_000;

function card(tool: string): ApprovalCard {
  return {
    approval_id: 'a1',
    tool_call_id: 'call-1',
    tool,
    title: 'Change something',
    target: { type: 'group', name: 'ops' },
    before: { description: 'a' },
    after: { description: 'b' },
    expires_at: '2026-11-26T05:41:05.000Z',
  };
}

function entry(tool = 'update_group_description'): Entry {
  return { card: card(tool), offsetMs: OFFSET, decision: undefined };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(BROWSER_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function item(onDecide = vi.fn<() => void>(), tool?: string, actingIn: string | null = null) {
  return (
    <ApprovalItem
      entry={entry(tool)}
      username="ada"
      actingIn={actingIn}
      step="waiting"
      words={PANEL_WORDING}
      onDecide={onDecide}
    />
  );
}

it('counts down by the server’s clock, announces only at one minute and at expiry, and then takes the buttons away', () => {
  render(item());
  // The server says 05:40:00, so 65 seconds are left, though the browser says 05:30:00.
  expect(screen.getByText('Expires in 2 min')).toBeInTheDocument();
  expect(screen.queryByText('One minute left to decide')).toBeNull();
  act(() => {
    vi.advanceTimersByTime(6_000);
  });
  expect(screen.getByText('Expires in 59 s')).toBeInTheDocument();
  expect(screen.getByText('One minute left to decide')).toBeInTheDocument();
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(screen.getByText('The approval expired')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  expect(screen.getByText('Expired. Nothing was changed.')).toBeInTheDocument();
});

it('decides with the entry it was given', async () => {
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  const onDecide = vi.fn<(entry: Entry, approve: boolean) => void>();
  render(
    <ApprovalItem
      entry={entry()}
      username="ada"
      actingIn={null}
      step="waiting"
      words={PANEL_WORDING}
      onDecide={onDecide}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Refuse' }));
  expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ offsetMs: OFFSET }), false);
  await user.click(screen.getByRole('button', { name: 'Approve' }));
  expect(onDecide).toHaveBeenLastCalledWith(expect.objectContaining({ offsetMs: OFFSET }), true);
});

it('asks once more before approving a change that removes something, and not before refusing it', async () => {
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  const onDecide = vi.fn<(entry: Entry, approve: boolean) => void>();
  render(
    <ApprovalItem
      entry={entry('clear_message_override')}
      username="ada"
      actingIn={null}
      step="waiting"
      words={PANEL_WORDING}
      onDecide={onDecide}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Approve' }));
  expect(onDecide).not.toHaveBeenCalled();
  const dialog = screen.getByRole('alertdialog', { name: 'Approve this removal?' });
  expect(dialog).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onDecide).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Approve' }));
  await user.click(screen.getByRole('button', { name: 'Approve removal' }));
  expect(onDecide).toHaveBeenCalledWith(expect.anything(), true);
  await user.click(screen.getByRole('button', { name: 'Refuse' }));
  expect(onDecide).toHaveBeenLastCalledWith(expect.anything(), false);
});

it('passes axe in both themes', async () => {
  vi.useRealTimers();
  expect(await axeInBothThemes(() => item())).toEqual({ light: [], dark: [] });
});

it('closes the extra question when the card expires, so approval is not offered after it', async () => {
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  render(
    <ApprovalItem
      entry={entry('clear_message_override')}
      username="ada"
      actingIn={null}
      step="waiting"
      words={PANEL_WORDING}
      onDecide={vi.fn<() => void>()}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Approve' }));
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  act(() => {
    vi.advanceTimersByTime(70_000);
  });
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Approve removal' })).toBeNull();
});

it('names the tenant in the question a removal asks, where the change is made in another one', async () => {
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  const onDecide = vi.fn<() => void>();
  render(item(onDecide, 'clear_message_override', 'demo'));
  await user.click(screen.getByRole('button', { name: 'Approve' }));
  const dialog = screen.getByRole('alertdialog', { name: 'Approve this removal in demo?' });
  expect(dialog).toHaveTextContent('in demo, not in your own tenant');
  expect(onDecide).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Approve removal' }));
  expect(onDecide).toHaveBeenCalledWith(expect.anything(), true);
});
