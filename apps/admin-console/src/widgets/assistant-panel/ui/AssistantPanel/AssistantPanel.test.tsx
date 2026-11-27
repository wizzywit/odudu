import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, problem, type Answer } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';
import {
  CONVERSATION,
  CONVERSATIONS,
  TEXT_TURN,
  VIEW,
  event,
  openStream,
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

async function ask(user: ReturnType<typeof userEvent.setup>, text = 'How many clients?') {
  const composer = screen.getByRole('textbox', { name: 'Message to the assistant' });
  await user.type(composer, text);
  await user.keyboard('{Enter}');
}

function status() {
  return screen.getByRole('status', { name: 'Assistant status' });
}

it('is a named region whose heading takes the focus when it opens', async () => {
  await renderPanel({});
  expect(screen.getByRole('complementary', { name: 'Assistant panel' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Assistant' })).toHaveFocus();
});

it('lies over the page as a dialog where there is no column for it, and Escape closes it', async () => {
  const user = userEvent.setup();
  const { onClose } = await renderPanel({}, { docked: false });
  expect(screen.getByRole('dialog', { name: 'Assistant panel' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Assistant' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('closes from its button when it has a column of its own', async () => {
  const user = userEvent.setup();
  const { onClose } = await renderPanel({});
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('says where it is, offers a message field and shows no Stop while nothing runs', async () => {
  await renderPanel({});
  expect(await screen.findByText('Ask about this tenant')).toBeInTheDocument();
  expect(screen.getByText('client c1')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Message to the assistant' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  expect(status()).toHaveTextContent('');
  expect(screen.getByText('Ask about this tenant')).toBeInTheDocument();
});

it('names the provider and who can read the conversation once, then never again', async () => {
  const user = userEvent.setup();
  const first = await renderPanel({});
  const notice = screen.getByRole('region', { name: 'Before you start' });
  expect(notice).toHaveTextContent('sent to Anthropic');
  expect(notice).toHaveTextContent('audit trail');
  await user.click(within(notice).getByRole('button', { name: 'Got it' }));
  expect(screen.queryByRole('region', { name: 'Before you start' })).toBeNull();
  first.unmount();
  await renderPanel({});
  expect(screen.queryByRole('region', { name: 'Before you start' })).toBeNull();
});

it('names a self-hosted model server by its host', async () => {
  await renderPanel(
    {},
    { view: { ...VIEW, provider: { kind: 'openai-compatible', host: 'llm.internal:8443' } } },
  );
  expect(screen.getByRole('region', { name: 'Before you start' })).toHaveTextContent(
    'llm.internal:8443',
  );
});

it('shows the notice again where the browser cannot remember it was read', async () => {
  const user = userEvent.setup();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  await renderPanel({});
  await user.click(screen.getByRole('button', { name: 'Got it' }));
  expect(screen.queryByRole('region', { name: 'Before you start' })).toBeNull();
  vi.restoreAllMocks();
});

it('offers no model picker with one model, and names the models where there are several', async () => {
  const user = userEvent.setup();
  const one = await renderPanel({});
  expect(screen.queryByText('Models')).toBeNull();
  one.unmount();
  await renderPanel({}, { view: { ...VIEW, modelChoices: ['model-f', 'model-s', 'model-d'] } });
  await user.click(screen.getByText('Models'));
  expect(screen.getByText('model-d')).toBeInTheDocument();
});

it('offers no mode switch where the server offers one mode', async () => {
  await renderPanel({}, { view: { ...VIEW, modes: ['ask'] } });
  expect(screen.queryByRole('radio')).toBeNull();
});

it('starts the conversation on the page the person is on, in Ask, then sends', async () => {
  const user = userEvent.setup();
  const { sent, onConversation } = await renderPanel({
    [`POST ${MESSAGES}`]: wholeStream(...TEXT_TURN),
  });
  await ask(user);

  expect(await screen.findByText(/clients\./u)).toBeInTheDocument();
  expect(sent.map((request) => `${request.method} ${request.path}`)).toEqual([
    `GET ${ACME_ADMIN}/assistant/last-conversation`,
    `POST ${CONVERSATIONS}`,
    `POST ${MESSAGES}`,
  ]);
  expect(sent[1]?.body).toEqual({
    profile: 'free-chat',
    mode: 'ask',
    page_context: { route: '/clients/c1', objectType: 'client', objectId: 'c1' },
  });
  expect(sent[2]?.body).toMatchObject({
    message: { role: 'user', parts: [{ type: 'text', text: 'How many clients?' }] },
  });
  expect(onConversation).toHaveBeenCalledWith('c1');
});

it('draws the answer as safe markdown and the person’s own words as the text they typed', async () => {
  const user = userEvent.setup();
  await renderPanel({ [`POST ${MESSAGES}`]: wholeStream(...TEXT_TURN) });
  await ask(user, '**not bold** <b>x</b>');
  const log = screen.getByRole('log', { name: 'Conversation' });
  expect(await within(log).findByText('three')).toBeInTheDocument();
  expect(within(log).getByText('three').tagName).toBe('STRONG');
  expect(within(log).getByText('**not bold** <b>x</b>')).toBeInTheDocument();
});

it('is connecting until the answer begins, then thinking, then finished, with Stop shown throughout', async () => {
  const user = userEvent.setup();
  const stream = openStream({ held: true });
  await renderPanel({ [`POST ${MESSAGES}`]: stream.answer });
  await ask(user);

  expect(await screen.findByRole('button', { name: 'Stop' })).toBeInTheDocument();
  await waitFor(() => {
    expect(status()).toHaveTextContent('Connecting');
  });
  stream.release();
  await waitFor(() => {
    expect(status()).toHaveTextContent('Thinking');
  });
  stream.push(event({ type: 'start', messageId: 'a1' }));
  stream.push(event({ type: 'text-start', id: 't1' }));
  stream.push(event({ type: 'text-delta', id: 't1', delta: 'Hel' }));
  await waitFor(() => {
    expect(status()).toHaveTextContent('Thinking');
  });
  expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();

  stream.push(event({ type: 'text-delta', id: 't1', delta: 'lo.' }));
  stream.push(event({ type: 'text-end', id: 't1' }));
  stream.push(event({ type: 'data-turn_end', data: { stopReason: 'done' }, transient: true }));
  stream.push(event({ type: 'finish' }));
  stream.push('data: [DONE]\n\n');
  stream.close();
  await waitFor(() => {
    expect(status()).toHaveTextContent('Finished');
  });
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  expect(screen.getByText('Hello.')).toBeInTheDocument();
});

it('never puts the words of an answer in the live region, and keeps the log out of it', async () => {
  const user = userEvent.setup();
  const stream = openStream();
  await renderPanel({ [`POST ${MESSAGES}`]: stream.answer });
  await ask(user);
  stream.push(event({ type: 'start', messageId: 'a1' }));
  stream.push(event({ type: 'text-start', id: 't1' }));
  stream.push(event({ type: 'text-delta', id: 't1', delta: 'Secret streamed words' }));
  expect(await screen.findByText('Secret streamed words')).toBeInTheDocument();
  expect(status()).not.toHaveTextContent('Secret');
  expect(status()).toHaveAttribute('aria-live', 'polite');
  expect(screen.getByRole('log', { name: 'Conversation' })).toHaveAttribute('aria-live', 'off');
  expect(screen.getByRole('article', { name: 'Assistant' })).toHaveAttribute('aria-busy', 'true');
  stream.close();
});

it('keeps the focus in the composer while the answer streams, and the person can go on typing', async () => {
  const user = userEvent.setup();
  const stream = openStream();
  await renderPanel({ [`POST ${MESSAGES}`]: stream.answer });
  await ask(user);
  const composer = screen.getByRole('textbox', { name: 'Message to the assistant' });
  expect(composer).toHaveFocus();
  expect(composer).toBeEnabled();
  await user.type(composer, 'and next');
  expect(composer).toHaveValue('and next');
  stream.close();
});

it('names the step a tool is on, and draws it as a step of the answer', async () => {
  const user = userEvent.setup();
  const stream = openStream();
  await renderPanel({ [`POST ${MESSAGES}`]: stream.answer });
  await ask(user);
  stream.push(event({ type: 'start', messageId: 'a1' }));
  stream.push(
    event({ type: 'tool-input-available', toolCallId: 'k1', toolName: 'list_clients', input: {} }),
  );
  await waitFor(() => {
    expect(status()).toHaveTextContent('Listing clients');
  });
  const steps = screen.getByRole('list', { name: 'Steps' });
  expect(within(steps).getByText('Running')).toBeInTheDocument();
  stream.push(event({ type: 'tool-output-available', toolCallId: 'k1', output: {} }));
  await waitFor(() => {
    expect(within(steps).getByText('Done')).toBeInTheDocument();
  });
  stream.close();
});

it('waits for the person when a change needs a decision, and says nothing is approved from here yet', async () => {
  const user = userEvent.setup();
  await renderPanel({
    [`POST ${MESSAGES}`]: wholeStream(
      event({ type: 'start', messageId: 'a1' }),
      event({
        type: 'tool-input-available',
        toolCallId: 'k2',
        toolName: 'create_client',
        input: {},
      }),
      event({ type: 'tool-approval-request', approvalId: 'ap1', toolCallId: 'k2' }),
      event({ type: 'data-turn_end', data: { stopReason: 'awaiting_approval' }, transient: true }),
      event({ type: 'finish' }),
    ),
  });
  await ask(user, 'Create a client');
  await waitFor(() => {
    expect(status()).toHaveTextContent('Waiting for you');
  });
  expect(screen.getByRole('note')).toHaveTextContent('waiting for your decision');
  expect(screen.getByText('Waiting for you', { selector: 'span' })).toBeInTheDocument();
});

it('says the step limit stopped it, in a notice, not an error', async () => {
  const user = userEvent.setup();
  await renderPanel({
    [`POST ${MESSAGES}`]: wholeStream(
      event({ type: 'start', messageId: 'a1' }),
      event({ type: 'data-turn_end', data: { stopReason: 'step_cap' }, transient: true }),
      event({ type: 'finish' }),
    ),
  });
  await ask(user);
  await waitFor(() => {
    expect(status()).toHaveTextContent('Stopped at the step limit');
  });
  expect(screen.getByRole('note')).toHaveTextContent('narrower question');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('names the allowance that stopped it, in the server’s words, and moves the meter to refused', async () => {
  const user = userEvent.setup();
  await renderPanel({
    [`POST ${MESSAGES}`]: wholeStream(
      event({ type: 'start', messageId: 'a1' }),
      event({
        type: 'error',
        errorText: 'This conversation has reached its allowance. Start a new one.',
      }),
      event({
        type: 'data-turn_end',
        data: { stopReason: 'budget_conversation' },
        transient: true,
      }),
    ),
  });
  await ask(user);
  await waitFor(() => {
    expect(status()).toHaveTextContent('Stopped: this conversation’s allowance is used');
  });
  expect(screen.getByRole('note')).toHaveTextContent(
    'This conversation has reached its allowance. Start a new one.',
  );
  expect(screen.getByText('Allowance used: this conversation’s allowance')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('warns at the share the server names, and says what happens at the limit', async () => {
  const user = userEvent.setup();
  await renderPanel({
    [`POST ${MESSAGES}`]: wholeStream(
      event({ type: 'start', messageId: 'a1' }),
      event({
        type: 'data-budget_warning',
        data: { level: 'tenant_month', percent: 83.7, slot: 'standard' },
        transient: true,
      }),
      event({ type: 'data-turn_end', data: { stopReason: 'done' }, transient: true }),
      event({ type: 'finish' }),
    ),
  });
  expect(screen.queryByText(/allowance/u)).toBeNull();
  await ask(user);
  expect(
    await screen.findByText('83% of this tenant’s monthly allowance used', { selector: 'p' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('note')).toHaveTextContent('does not switch to another model');
});

it('fails in plain words, with the request’s reference, and no stack', async () => {
  const user = userEvent.setup();
  await renderPanel({
    [`POST ${MESSAGES}`]: () =>
      new Response(
        JSON.stringify({
          type: 'about:blank',
          title: 'Too Many Requests',
          status: 429,
          instance: 'req-77',
        }),
        { status: 429, headers: { 'content-type': 'application/problem+json' } },
      ),
  });
  await ask(user);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('The assistant is busy right now. Try again in a moment.');
  expect(alert).toHaveTextContent('req-77');
  expect(alert.textContent).not.toMatch(/at \w+ \(|\.ts:\d+|stack/u);
  expect(status()).toHaveTextContent('');
});

it('fails with a generic cause when the stream breaks, and invents no reference', async () => {
  const user = userEvent.setup();
  await renderPanel({
    [`POST ${MESSAGES}`]: wholeStream(
      event({ type: 'start', messageId: 'a1' }),
      event({
        type: 'error',
        errorText: 'The assistant could not finish this answer. Please try again.',
      }),
      event({ type: 'data-turn_end', data: { stopReason: 'error' }, transient: true }),
    ),
  });
  await ask(user);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('The assistant could not finish this answer. Please try again.');
  expect(within(alert).queryByText('Reference')).toBeNull();
});

it('fails in plain words when the conversation cannot be started', async () => {
  const user = userEvent.setup();
  await renderPanel({ [`POST ${CONVERSATIONS}`]: problem(403) });
  await ask(user);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'You do not have permission to use the assistant here.',
  );
});

it('stops the answer here and on the server, and puts the focus back in the composer', async () => {
  const user = userEvent.setup();
  const stream = openStream();
  const { sent } = await renderPanel({
    [`POST ${MESSAGES}`]: stream.answer,
    [`POST ${CONVERSATIONS}/c1/stop`]: json({ stopped: true }),
  });
  await ask(user);
  stream.push(event({ type: 'start', messageId: 'a1' }));
  await user.click(await screen.findByRole('button', { name: 'Stop' }));

  await waitFor(() => {
    expect(status()).toHaveTextContent('Stopped');
  });
  expect(screen.getByRole('note')).toHaveTextContent('Nothing further was run');
  expect(screen.getByRole('textbox', { name: 'Message to the assistant' })).toHaveFocus();
  expect(sent.some((request) => request.path === `${CONVERSATIONS}/c1/stop`)).toBe(true);
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
});

it('opens on a conversation the person had, reading it from the server', async () => {
  await renderPanel(
    {
      [`GET ${CONVERSATIONS}/c1`]: json({
        ...CONVERSATION,
        mode: 'ask',
        messages: [
          { id: 'c1-1', role: 'user', parts: [{ type: 'text', text: 'Earlier question' }] },
          { id: 'c1-2', role: 'assistant', parts: [{ type: 'text', text: 'Earlier answer' }] },
        ],
      }),
    },
    { conversationId: 'c1' },
  );
  expect(await screen.findByText('Earlier answer')).toBeInTheDocument();
  expect(screen.getByText('Earlier question')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Ask' })).toBeChecked();
  expect(status()).toHaveTextContent('Finished');
});

it('says the conversation cannot be read when the server will not give it', async () => {
  await renderPanel({ [`GET ${CONVERSATIONS}/c1`]: problem(404) }, { conversationId: 'c1' });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The conversation could not be loaded.',
  );
  expect(status()).toHaveTextContent('');
});

it('is reached in an order a keyboard can follow: close, mode, models, field, send', async () => {
  const user = userEvent.setup();
  await renderPanel({}, { view: { ...VIEW, modelChoices: ['a', 'b'] } });
  const order: string[] = [];
  for (let step = 0; step < 14; step += 1) {
    await user.tab();
    const focused = document.activeElement;
    order.push(focused?.getAttribute('aria-label') ?? focused?.textContent ?? '');
  }
  expect(order).toContain('Close');
  expect(order).toContain('Message to the assistant');
  expect(order.indexOf('Close')).toBeLessThan(order.indexOf('Message to the assistant'));
  expect(order).toContain('Models');
});

it('closes on Escape, once, when it has a column of its own', async () => {
  const user = userEvent.setup();
  const { onClose } = await renderPanel({});
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledTimes(1);
});

// The shell hands the new conversation's id back as `conversationId`, and the
// stored conversation answers a read: neither may disturb the live turn.
it('does not read, show or seed the conversation it has just started, mid-stream', async () => {
  const user = userEvent.setup();
  const stream = openStream();
  const { sent } = await renderPanel({
    [`POST ${MESSAGES}`]: stream.answer,
    [`GET ${CONVERSATIONS}/c1`]: json({
      ...CONVERSATION,
      messages: [
        { id: 'c1-1', role: 'user', parts: [{ type: 'text', text: 'How many clients?' }] },
      ],
    }),
  });
  await ask(user);
  stream.push(event({ type: 'start', messageId: 'a1' }));
  stream.push(
    event({ type: 'tool-input-available', toolCallId: 'k1', toolName: 'list_clients', input: {} }),
  );
  await waitFor(() => {
    expect(status()).toHaveTextContent('Listing clients');
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(status()).not.toHaveTextContent('Loading the conversation');
  expect(screen.queryByText('Loading the conversation', { selector: 'span' })).toBeNull();
  expect(
    sent.filter(
      (request) => request.method === 'GET' && !request.path.endsWith('/last-conversation'),
    ),
  ).toEqual([]);
  expect(screen.getByRole('list', { name: 'Steps' })).toBeInTheDocument();
  stream.push(event({ type: 'data-turn_end', data: { stopReason: 'done' }, transient: true }));
  stream.push(event({ type: 'finish' }));
  stream.push('data: [DONE]\n\n');
  stream.close();
  await waitFor(() => {
    expect(status()).toHaveTextContent('Finished');
  });
  expect(screen.getByRole('list', { name: 'Steps' })).toBeInTheDocument();
});

it('says the connection closed, not that the answer finished, when the stream ends with no turn end', async () => {
  const user = userEvent.setup();
  const stream = openStream();
  await renderPanel({ [`POST ${MESSAGES}`]: stream.answer });
  await ask(user);
  stream.push(event({ type: 'start', messageId: 'a1' }));
  stream.push(event({ type: 'text-start', id: 't1' }));
  stream.push(event({ type: 'text-delta', id: 't1', delta: 'Half an' }));
  stream.close();
  await waitFor(() => {
    expect(status()).toHaveTextContent('Stopped, connection closed');
  });
  expect(status()).not.toHaveTextContent('Finished');
  expect(screen.getByRole('note')).toHaveTextContent(
    'The connection closed before the answer finished',
  );
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps an answer running when the panel is closed, and shows it again when it is opened', async () => {
  const user = userEvent.setup();
  const stream = openStream();
  const { sent, host } = await renderPanel({ [`POST ${MESSAGES}`]: stream.answer });
  await ask(user);
  stream.push(event({ type: 'start', messageId: 'a1' }));
  stream.push(event({ type: 'text-start', id: 't1' }));
  stream.push(event({ type: 'text-delta', id: 't1', delta: 'Still ' }));
  await screen.findByText('Still');
  act(() => {
    host.setOpen(false);
  });
  expect(screen.queryByRole('complementary')).toBeNull();
  stream.push(event({ type: 'text-delta', id: 't1', delta: 'going.' }));
  stream.push(event({ type: 'text-end', id: 't1' }));
  stream.push(event({ type: 'data-turn_end', data: { stopReason: 'done' }, transient: true }));
  stream.push(event({ type: 'finish' }));
  stream.push('data: [DONE]\n\n');
  stream.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  act(() => {
    host.setOpen(true);
  });
  expect(await screen.findByText('Still going.')).toBeInTheDocument();
  expect(status()).toHaveTextContent('Finished');
  expect(sent.some((request) => request.path.endsWith('/stop'))).toBe(false);
});

it('lands at the end of the conversation when it is opened, though the answer finished while it was closed', async () => {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.getAttribute('role') === 'log' ? 1000 : 0;
  });
  const user = userEvent.setup();
  const stream = openStream();
  const { host } = await renderPanel({ [`POST ${MESSAGES}`]: stream.answer });
  await ask(user);
  stream.push(event({ type: 'start', messageId: 'a1' }));
  stream.push(event({ type: 'text-start', id: 't1' }));
  stream.push(event({ type: 'text-delta', id: 't1', delta: 'Begin' }));
  await screen.findByText('Begin');
  act(() => {
    host.setOpen(false);
  });
  stream.push(event({ type: 'text-delta', id: 't1', delta: ' and a very long end.' }));
  stream.push(event({ type: 'text-end', id: 't1' }));
  stream.push(event({ type: 'data-turn_end', data: { stopReason: 'done' }, transient: true }));
  stream.push(event({ type: 'finish' }));
  stream.push('data: [DONE]\n\n');
  stream.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  act(() => {
    host.setOpen(true);
  });
  const log = await screen.findByRole('log', { name: 'Conversation' });
  expect(log.scrollTop).toBe(1000);
});

it('keeps what was being typed when the panel is put away and opened, and clears it on send', async () => {
  const user = userEvent.setup();
  const { host } = await renderPanel({ [`POST ${MESSAGES}`]: wholeStream(...TEXT_TURN) });
  await user.type(screen.getByRole('textbox', { name: 'Message to the assistant' }), 'half a thou');
  act(() => {
    host.setOpen(false);
  });
  act(() => {
    host.setOpen(true);
  });
  const field = await screen.findByRole('textbox', { name: 'Message to the assistant' });
  expect(field).toHaveValue('half a thou');
  await user.type(field, 'ght{Enter}');
  expect(await screen.findByText(/clients\./u)).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Message to the assistant' })).toHaveValue('');
});

it('starts a fresh conversation from its header when idle, and not while an answer runs', async () => {
  const user = userEvent.setup();
  const stream = openStream();
  let created = 0;
  const { sent, onConversation } = await renderPanel({
    [`POST ${CONVERSATIONS}`]: () => {
      created += 1;
      return new Response(JSON.stringify({ ...CONVERSATION, id: `c${String(created)}` }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    },
    [`POST ${CONVERSATIONS}/c1/messages`]: wholeStream(...TEXT_TURN),
    [`POST ${CONVERSATIONS}/c2/messages`]: stream.answer,
  });
  expect(screen.getByRole('button', { name: 'New conversation' })).toBeDisabled();
  await ask(user);
  expect(await screen.findByText(/clients\./u)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'New conversation' }));
  expect(screen.queryByText(/clients\./u)).toBeNull();
  expect(screen.getByText('Ask about this tenant')).toBeInTheDocument();
  await ask(user, 'Second');
  await waitFor(() => {
    expect(onConversation).toHaveBeenLastCalledWith('c2');
  });
  expect(sent.filter((request) => request.path === CONVERSATIONS)).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'New conversation' })).toBeDisabled();
  stream.close();
});

it('does not end a running answer when the dialog over the page is dismissed by Escape', async () => {
  const user = userEvent.setup();
  const stream = openStream();
  const { sent, onClose } = await renderPanel(
    { [`POST ${MESSAGES}`]: stream.answer },
    { docked: false },
  );
  await ask(user);
  stream.push(event({ type: 'start', messageId: 'a1' }));
  stream.push(event({ type: 'text-start', id: 't1' }));
  stream.push(event({ type: 'text-delta', id: 't1', delta: 'Working' }));
  await screen.findByText('Working');
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(sent.some((request) => request.path.endsWith('/stop'))).toBe(false);
  stream.close();
});

it('says nothing about the allowance until the server says something', async () => {
  await renderPanel({});
  expect(screen.queryByText(/allowance/u)).toBeNull();
});

it('keeps a refusal in the meter through the next send, until a turn ends well', async () => {
  const user = userEvent.setup();
  let turns = 0;
  await renderPanel({
    [`POST ${MESSAGES}`]: () => {
      turns += 1;
      return turns === 1
        ? new Response(
            `${event({ type: 'start', messageId: 'a1' })}${event({ type: 'data-turn_end', data: { stopReason: 'budget_admin' }, transient: true })}data: [DONE]\n\n`,
            { headers: { 'content-type': 'text/event-stream' } },
          )
        : new Response(`${[...TEXT_TURN].join('')}data: [DONE]\n\n`, {
            headers: { 'content-type': 'text/event-stream' },
          });
    },
  });
  await ask(user);
  expect(
    await screen.findByText('Allowance used: your share of today’s allowance'),
  ).toBeInTheDocument();
  await ask(user, 'Again');
  await waitFor(() => {
    expect(status()).toHaveTextContent('Finished');
  });
  expect(screen.queryByText(/Allowance used/u)).toBeNull();
});

it('offers Act disabled with the sentence that says why', async () => {
  await renderPanel({});
  expect(screen.getByRole('radio', { name: 'Act' })).toBeDisabled();
  expect(screen.getByText('Act needs the approval card, which arrives next.')).toBeInTheDocument();
});

it('starts in Ask even where the tenant starts in Act', async () => {
  await renderPanel({}, { view: { ...VIEW, defaultMode: 'act' } });
  expect(screen.getByRole('radio', { name: 'Ask' })).toBeChecked();
});

it('shows a conversation already in Act as waiting, with a composer that cannot send', async () => {
  await renderPanel(
    { [`GET ${CONVERSATIONS}/c1`]: json({ ...CONVERSATION, mode: 'act' }) },
    { conversationId: 'c1' },
  );
  await waitFor(() => {
    expect(status()).toHaveTextContent('Waiting for you');
  });
  expect(screen.getByRole('note')).toHaveTextContent('Act needs the approval card');
  expect(screen.getByRole('textbox', { name: 'Message to the assistant' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
});

it('words a message refused because a turn is running as exactly that', async () => {
  const user = userEvent.setup();
  await renderPanel({
    [`POST ${MESSAGES}`]: () =>
      new Response(
        JSON.stringify({
          type: 'about:blank',
          title: 'Conflict',
          status: 409,
          detail: 'a turn is already running in this conversation',
        }),
        { status: 409, headers: { 'content-type': 'application/problem+json' } },
      ),
  });
  await ask(user);
  expect(await screen.findByRole('alert')).toHaveTextContent('still running');
});

it.each([
  ['beside the page', true],
  ['over the page', false],
])('passes axe in both themes %s', async (_name, docked) => {
  expect(
    await axeInBothThemes(
      () => panelElement({}, { docked, view: { ...VIEW, modelChoices: ['a', 'b'] } }).element,
      () => screen.findByRole('textbox', { name: 'Message to the assistant' }),
    ),
  ).toEqual({ light: [], dark: [] });
});

describe('for a system administrator acting in another tenant', () => {
  const DEMO = ACME_ADMIN.replace('acme', 'demo');
  const DEMO_CONVERSATIONS = `${DEMO}/assistant/conversations`;
  const DEMO_MESSAGES = `${DEMO_CONVERSATIONS}/c1/messages`;
  const routes = (more: Record<string, Answer> = {}) => ({
    [`POST ${DEMO_CONVERSATIONS}`]: json(CONVERSATION, 201),
    ...more,
  });

  it('names the tenant it acts in, and does not offer Act, saying why', async () => {
    await renderPanel(routes(), { actingIn: 'demo' });
    expect(screen.getByText('Acting in demo')).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Ask' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Act' })).toBeDisabled();
    expect(screen.getByText('Act is not available in another tenant.')).toBeInTheDocument();
  });

  it('keeps the tag while the conversation runs and after it, and draws none in the own tenant', async () => {
    const user = userEvent.setup();
    await renderPanel(routes({ [`POST ${DEMO_MESSAGES}`]: wholeStream(...TEXT_TURN) }), {
      actingIn: 'demo',
    });
    await ask(user);
    expect(await screen.findByText(/clients\./u)).toBeInTheDocument();
    expect(screen.getByText('Acting in demo')).toBeVisible();
  });

  it('starts the conversation in Ask at the target tenant’s path, which is where the server binds it', async () => {
    const user = userEvent.setup();
    const { sent } = await renderPanel(
      routes({ [`POST ${DEMO_MESSAGES}`]: wholeStream(...TEXT_TURN) }),
      { actingIn: 'demo' },
    );
    await ask(user);
    await screen.findByText(/clients\./u);
    expect(sent.map((request) => `${request.method} ${request.path}`)).toEqual([
      `GET ${DEMO}/assistant/last-conversation`,
      `POST ${DEMO_CONVERSATIONS}`,
      `POST ${DEMO_MESSAGES}`,
    ]);
    expect(sent[1]?.body).toMatchObject({ mode: 'ask' });
  });

  it('tells the person whose allowance pays and what the tenant’s administrators see', async () => {
    await renderPanel(routes(), { actingIn: 'demo' });
    const notice = screen.getByRole('region', { name: 'Before you start' });
    expect(notice).toHaveTextContent('Your own tenant pays for this conversation.');
    expect(notice).toHaveTextContent('Administrators of demo see that you used the assistant');
  });

  it('shows the notice for another tenant even after the own tenant’s was read', async () => {
    window.localStorage.setItem('odudu.console.assistant.notice-read', '1');
    await renderPanel(routes(), { actingIn: 'demo' });
    expect(screen.getByRole('region', { name: 'Before you start' })).toBeInTheDocument();
  });

  it('says the tenant has switched the assistant off when the conversation is refused as unserved', async () => {
    const user = userEvent.setup();
    await renderPanel({ [`POST ${DEMO_CONVERSATIONS}`]: problem(404) }, { actingIn: 'demo' });
    await ask(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The assistant is not available in demo. demo may have switched it off, or your own tenant has.',
    );
  });

  it('names the two capabilities when the administrator no longer holds them', async () => {
    const user = userEvent.setup();
    await renderPanel({ [`POST ${DEMO_CONVERSATIONS}`]: problem(403) }, { actingIn: 'demo' });
    await ask(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You need use-assistant and manage-tenants to use the assistant in demo.',
    );
  });

  it('draws a tool the target refused as a refused step, not as a failed turn', async () => {
    const user = userEvent.setup();
    await renderPanel(
      routes({
        [`POST ${DEMO_MESSAGES}`]: wholeStream(
          event({ type: 'start', messageId: 'a1' }),
          event({ type: 'tool-input-start', toolCallId: 't1', toolName: 'list_subjects' }),
          event({
            type: 'tool-input-available',
            toolCallId: 't1',
            toolName: 'list_subjects',
            input: {},
          }),
          event({ type: 'tool-output-denied', toolCallId: 't1' }),
          event({ type: 'data-turn_end', data: { stopReason: 'done' }, transient: true }),
          event({ type: 'finish' }),
        ),
      }),
      { actingIn: 'demo' },
    );
    await ask(user);
    expect(await screen.findByText('Refused')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
