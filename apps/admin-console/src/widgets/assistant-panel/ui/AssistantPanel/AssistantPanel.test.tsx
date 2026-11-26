import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { json, problem } from '#/testing/fakeTransport';
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

it('closes from its button and on Escape, once for one Escape, when it has a column of its own', async () => {
  const user = userEvent.setup();
  const { onClose } = await renderPanel({});
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledTimes(2);
});

it('says where it is, offers a message field and shows no Stop while nothing runs', async () => {
  await renderPanel({});
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

it('offers Ask and Act, and starts in the mode the tenant chose', async () => {
  await renderPanel({}, { view: { ...VIEW, defaultMode: 'act' } });
  expect(screen.getByRole('radio', { name: 'Act' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Ask' })).not.toBeChecked();
});

it('offers no mode switch where the server offers one mode', async () => {
  await renderPanel({}, { view: { ...VIEW, modes: ['ask'] } });
  expect(screen.queryByRole('radio')).toBeNull();
});

it('starts the conversation on the page the person is on, in the mode they chose, then sends', async () => {
  const user = userEvent.setup();
  const { sent, onConversation } = await renderPanel({
    [`POST ${MESSAGES}`]: wholeStream(...TEXT_TURN),
  });
  await user.click(screen.getByRole('radio', { name: 'Act' }));
  await ask(user);

  expect(await screen.findByText(/clients\./u)).toBeInTheDocument();
  expect(sent.map((request) => `${request.method} ${request.path}`)).toEqual([
    `POST ${CONVERSATIONS}`,
    `POST ${MESSAGES}`,
  ]);
  expect(sent[0]?.body).toEqual({
    profile: 'free-chat',
    mode: 'act',
    page_context: { route: '/clients/c1', objectType: 'client', objectId: 'c1' },
  });
  expect(sent[1]?.body).toMatchObject({
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
  expect(screen.getByText('Within your allowance')).toBeInTheDocument();
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
  expect(status()).toHaveTextContent('Failed');
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

it('switches the mode on the server once the conversation exists, and says when it cannot', async () => {
  const user = userEvent.setup();
  const { sent } = await renderPanel(
    {
      [`PUT ${CONVERSATIONS}/c1/mode`]: json({ mode: 'act' }),
    },
    { conversationId: 'c1' },
  );
  await user.click(screen.getByRole('radio', { name: 'Act' }));
  await waitFor(() => {
    expect(sent.some((request) => request.method === 'PUT')).toBe(true);
  });
  expect(sent.find((request) => request.method === 'PUT')?.body).toEqual({ mode: 'act' });
  expect(await screen.findByRole('radio', { name: 'Act' })).toBeChecked();
});

it('keeps the mode where it was, and says so, when the server refuses the switch', async () => {
  const user = userEvent.setup();
  await renderPanel(
    {
      [`GET ${CONVERSATIONS}/c1`]: json(CONVERSATION),
      [`PUT ${CONVERSATIONS}/c1/mode`]: problem(409),
    },
    { conversationId: 'c1' },
  );
  await user.click(screen.getByRole('radio', { name: 'Act' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The mode could not be changed');
  expect(screen.getByRole('radio', { name: 'Ask' })).toBeChecked();
});

it('opens on a conversation the person had, reading it from the server', async () => {
  await renderPanel(
    {
      [`GET ${CONVERSATIONS}/c1`]: json({
        ...CONVERSATION,
        mode: 'act',
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
  expect(screen.getByRole('radio', { name: 'Act' })).toBeChecked();
  expect(status()).toHaveTextContent('Finished');
});

it('says the conversation cannot be read when the server will not give it', async () => {
  await renderPanel({ [`GET ${CONVERSATIONS}/c1`]: problem(404) }, { conversationId: 'c1' });
  expect(await screen.findByRole('alert')).toHaveTextContent('could not finish');
  expect(status()).toHaveTextContent('Failed');
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
