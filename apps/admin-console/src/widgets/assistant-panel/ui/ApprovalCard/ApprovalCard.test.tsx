import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { cardModel } from '#/widgets/assistant-panel/services/approval';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import type { ApprovalCard as Card, Decision } from '#/widgets/assistant-panel/types/approvals';
import { ApprovalCard } from '#/widgets/assistant-panel/ui/ApprovalCard';

const CARD: Card = {
  approval_id: 'a1',
  tool_call_id: 'call-1',
  tool: 'update_role_description',
  title: 'Change the description of a role',
  target: { type: 'role', id: '01a2165a-3934-7734-8735-999817309513', name: 'auditors' },
  before: { description: 'Old text' },
  after: { description: 'Reviews the audit trail' },
  expires_at: '2026-11-26T05:45:00.000Z',
};

function view(decision?: Decision, seconds = 240) {
  const onApprove = vi.fn<() => void>();
  const onRefuse = vi.fn<() => void>();
  const model = cardModel({ card: CARD, username: 'ada', decision, seconds });
  const ui = (
    <ApprovalCard model={model} words={PANEL_WORDING} onApprove={onApprove} onRefuse={onRefuse} />
  );
  return { ui, onApprove, onRefuse };
}

it('puts the evidence first: the action, its target, who decides, the time and the exact change', () => {
  render(view().ui);
  const card = screen.getByRole('region', { name: 'Change the description of a role' });
  expect(within(card).getByText('auditors')).toBeInTheDocument();
  expect(within(card).getByText(/You, as ada/u)).toBeInTheDocument();
  expect(within(card).getByText(/The assistant cannot answer it/u)).toBeInTheDocument();
  expect(within(card).getByText('Expires in 4 min')).toBeInTheDocument();
  expect(within(card).getByText('Old text')).toBeInTheDocument();
  expect(within(card).getByText('Reviews the audit trail')).toBeInTheDocument();
  expect(within(card).getByRole('button', { name: /Copy the role id/u })).toBeInTheDocument();
  expect(
    within(card).getByText('Nothing is changed. The assistant is told you refused.'),
  ).toBeInTheDocument();
});

it('does not take the focus when it appears, and neither button is the one that has it', () => {
  render(view().ui);
  expect(document.body).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Approve' })).not.toHaveFocus();
  expect(screen.getByRole('button', { name: 'Refuse' })).not.toHaveFocus();
});

it('sends the person’s choice, and nothing else is a way to answer', async () => {
  const user = userEvent.setup();
  const { ui, onApprove, onRefuse } = view();
  render(ui);
  expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
    expect.stringContaining('Copy') as string,
    'Approve',
    'Refuse',
  ]);
  await user.click(screen.getByRole('button', { name: 'Refuse' }));
  expect(onRefuse).toHaveBeenCalledTimes(1);
  expect(onApprove).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Approve' }));
  expect(onApprove).toHaveBeenCalledTimes(1);
});

it('disables both buttons while the decision is sent, and says so', () => {
  render(view({ kind: 'deciding', approve: true }).ui);
  expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Refuse' })).toBeDisabled();
  expect(screen.getByText('Sending your decision')).toBeInTheDocument();
});

it.each([
  ['approved', 'Approved by you. The change was made.'],
  ['denied', 'Refused by you. Nothing was changed.'],
] as const)('replaces the buttons with the outcome once it is %s', (state, outcome) => {
  render(view({ kind: 'decided', state }).ui);
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Refuse' })).toBeNull();
  expect(screen.getByText(outcome)).toBeInTheDocument();
});

it('shows expiry as expiry, with no button that could approve after it', () => {
  render(view(undefined, 0).ui);
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  expect(screen.getByText('Expired. Nothing was changed.')).toBeInTheDocument();
});

it('says in an alert why a decision was refused, and offers no second try when it cannot work', () => {
  const open = render(
    view({ kind: 'failed', problem: 'The console could not reach the server.', final: false }).ui,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('could not reach');
  expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  open.unmount();
  render(view({ kind: 'failed', problem: 'Already decided.', final: true }).ui);
  expect(screen.getByRole('alert')).toHaveTextContent('Already decided.');
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
});

it('passes axe in both themes, open and decided', async () => {
  expect(await axeInBothThemes(() => view().ui)).toEqual({ light: [], dark: [] });
  expect(await axeInBothThemes(() => view({ kind: 'decided', state: 'approved' }).ui)).toEqual({
    light: [],
    dark: [],
  });
});
