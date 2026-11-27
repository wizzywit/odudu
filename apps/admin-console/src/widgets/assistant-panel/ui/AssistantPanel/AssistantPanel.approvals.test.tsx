import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { json, problem } from '#/testing/fakeTransport';
import {
  CONVERSATION,
  CONVERSATIONS,
  event,
  panelElement,
  renderPanel,
  wholeStream,
} from '#/testing/assistantPanel';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { resetConsole } from '#/testing/resetConsole';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  resetConsole();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const MESSAGES = `${CONVERSATIONS}/c1/messages`;
const APPROVALS = `${CONVERSATIONS}/c1/approvals`;
const RESUME = `${CONVERSATIONS}/c1/resume`;
const CARD = {
  approval_id: 'ap1',
  tool_call_id: 'call-1',
  tool: 'update_role_description',
  title: 'Change the description of a role',
  target: { type: 'role', id: 'r1', name: 'auditors' },
  before: { description: 'Old text' },
  after: { description: 'Reviews the audit trail' },
  // Far enough ahead that the card is open for the whole test.
  expires_at: '2099-01-01T00:00:00.000Z',
};

const PROPOSAL = wholeStream(
  event({ type: 'start', messageId: 'a1' }),
  event({ type: 'tool-input-start', toolCallId: 'call-1', toolName: 'update_role_description' }),
  event({
    type: 'tool-input-available',
    toolCallId: 'call-1',
    toolName: 'update_role_description',
    input: { id: 'r1', description: 'Reviews the audit trail' },
  }),
  event({ type: 'tool-approval-request', approvalId: 'sdk-1', toolCallId: 'call-1' }),
  event({ type: 'data-turn_end', data: { stopReason: 'awaiting_approval' }, transient: true }),
  event({ type: 'finish' }),
);

const AFTER_APPROVAL = wholeStream(
  event({ type: 'start', messageId: 'a1' }),
  event({ type: 'text-start', id: 't1' }),
  event({ type: 'text-delta', id: 't1', delta: 'Done. The role now has the new description.' }),
  event({ type: 'text-end', id: 't1' }),
  event({ type: 'data-turn_end', data: { stopReason: 'done' }, transient: true }),
  event({ type: 'finish' }),
);

async function ask(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByRole('textbox', { name: 'Message to the assistant' }),
    'Describe auditors',
  );
  await user.keyboard('{Enter}');
}

function status() {
  return screen.getByRole('status', { name: 'Assistant status' });
}

const waitingRoutes = {
  [`POST ${MESSAGES}`]: PROPOSAL,
  [`GET ${APPROVALS}`]: json({ items: [CARD] }, 200, { date: 'Thu, 26 Nov 2026 05:40:00 GMT' }),
};

it('starts a conversation in Act when the person switched to Act first', async () => {
  const user = userEvent.setup();
  const { sent } = await renderPanel(waitingRoutes);
  await user.click(screen.getByRole('radio', { name: 'Act' }));
  expect(screen.getByRole('radio', { name: 'Act' })).toBeChecked();
  await ask(user);
  await screen.findByRole('region', { name: CARD.title });
  expect(sent.find((request) => request.path === CONVERSATIONS)?.body).toMatchObject({
    mode: 'act',
  });
});

it('switches the mode of a conversation that has started, and says when it could not', async () => {
  const user = userEvent.setup();
  const { sent } = await renderPanel(
    {
      [`GET ${CONVERSATIONS}/c1`]: json(CONVERSATION),
      [`PUT ${CONVERSATIONS}/c1/mode`]: json({ mode: 'act' }),
    },
    { conversationId: 'c1' },
  );
  await waitFor(() => {
    expect(screen.getByRole('radio', { name: 'Ask' })).toBeChecked();
  });
  await user.click(screen.getByRole('radio', { name: 'Act' }));
  await waitFor(() => {
    expect(screen.getByRole('radio', { name: 'Act' })).toBeChecked();
  });
  expect(sent.at(-1)).toMatchObject({ method: 'PUT', body: { mode: 'act' } });
});

it('keeps the mode and says so when the server refuses the switch', async () => {
  const user = userEvent.setup();
  await renderPanel(
    {
      [`GET ${CONVERSATIONS}/c1`]: json(CONVERSATION),
      [`PUT ${CONVERSATIONS}/c1/mode`]: problem(409),
    },
    { conversationId: 'c1' },
  );
  await user.click(await screen.findByRole('radio', { name: 'Act' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be changed');
  expect(screen.getByRole('radio', { name: 'Ask' })).toBeChecked();
});

it('shows the card of a change that waits, announces it once, and does not take the focus', async () => {
  const user = userEvent.setup();
  await renderPanel(waitingRoutes);
  await ask(user);
  const card = await screen.findByRole('region', { name: CARD.title });
  expect(within(card).getByText('Old text')).toBeInTheDocument();
  expect(within(card).getByText('Reviews the audit trail')).toBeInTheDocument();
  expect(within(card).getByText(/You, as ada/u)).toBeInTheDocument();
  await waitFor(() => {
    expect(status()).toHaveTextContent(`Approval needed: ${CARD.title}`);
  });
  expect(card).not.toContainElement(document.activeElement as HTMLElement);
  expect(screen.getByRole('textbox', { name: 'Message to the assistant' })).toBeDisabled();
});

it('moves to the card only when the person asks', async () => {
  const user = userEvent.setup();
  await renderPanel(waitingRoutes);
  await ask(user);
  const card = await screen.findByRole('region', { name: CARD.title });
  await user.click(screen.getByRole('button', { name: 'Jump to approval' }));
  expect(card).toHaveFocus();
});

it('sends the approval, shows who decided, and carries the answer on', async () => {
  const user = userEvent.setup();
  const { sent } = await renderPanel({
    ...waitingRoutes,
    [`POST ${APPROVALS}/ap1`]: json({ state: 'approved' }),
    [`POST ${RESUME}`]: AFTER_APPROVAL,
  });
  await ask(user);
  const card = await screen.findByRole('region', { name: CARD.title });
  await user.click(within(card).getByRole('button', { name: 'Approve' }));
  expect(
    await screen.findByText('Done. The role now has the new description.'),
  ).toBeInTheDocument();
  expect(within(card).getByText('Approved by you. The change was made.')).toBeInTheDocument();
  expect(within(card).queryByRole('button', { name: 'Approve' })).toBeNull();
  const decide = sent.filter((request) => request.path === `${APPROVALS}/ap1`);
  expect(decide).toHaveLength(1);
  expect(decide[0]).toMatchObject({ method: 'POST', body: { approve: true } });
  const order = sent.map((request) => `${request.method} ${request.path}`);
  expect(order.indexOf(`POST ${APPROVALS}/ap1`)).toBeLessThan(order.indexOf(`POST ${RESUME}`));
});

it('tells the assistant of a refusal and says nothing was changed', async () => {
  const user = userEvent.setup();
  const { sent } = await renderPanel({
    ...waitingRoutes,
    [`POST ${APPROVALS}/ap1`]: json({ state: 'denied' }),
    [`POST ${RESUME}`]: AFTER_APPROVAL,
  });
  await ask(user);
  const card = await screen.findByRole('region', { name: CARD.title });
  expect(
    within(card).getByText('Nothing is changed. The assistant is told you refused.'),
  ).toBeInTheDocument();
  await user.click(within(card).getByRole('button', { name: 'Refuse' }));
  expect(await within(card).findByText('Refused by you. Nothing was changed.')).toBeInTheDocument();
  expect(sent.find((request) => request.path === `${APPROVALS}/ap1`)).toMatchObject({
    body: { approve: false },
  });
  await screen.findByText('Done. The role now has the new description.');
});

it('says in an alert that a change was already decided, and sends no second answer', async () => {
  const user = userEvent.setup();
  const { sent } = await renderPanel({
    ...waitingRoutes,
    [`POST ${APPROVALS}/ap1`]: problem(409),
  });
  await ask(user);
  const card = await screen.findByRole('region', { name: CARD.title });
  await user.click(within(card).getByRole('button', { name: 'Approve' }));
  expect(await within(card).findByRole('alert')).toHaveTextContent(
    'already decided or has expired',
  );
  expect(within(card).queryByRole('button', { name: 'Approve' })).toBeNull();
  expect(sent.some((request) => request.path === RESUME)).toBe(false);
});

it('says the person alone may decide, when the server refuses the sign-in', async () => {
  const user = userEvent.setup();
  await renderPanel({ ...waitingRoutes, [`POST ${APPROVALS}/ap1`]: problem(403) });
  await ask(user);
  const card = await screen.findByRole('region', { name: CARD.title });
  await user.click(within(card).getByRole('button', { name: 'Refuse' }));
  expect(await within(card).findByRole('alert')).toHaveTextContent('Only you');
});

it('passes axe in both themes with a card waiting', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => panelElement(waitingRoutes).element,
      async () => {
        await screen.findByRole('textbox', { name: 'Message to the assistant' });
        await ask(user);
        return screen.findByRole('region', { name: CARD.title });
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
