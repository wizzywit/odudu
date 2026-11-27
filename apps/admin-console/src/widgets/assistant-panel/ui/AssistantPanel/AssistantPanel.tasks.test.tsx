import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TaskRequest } from '#/entities/assistant';
import { json } from '#/testing/fakeTransport';
import {
  CONVERSATIONS,
  TEXT_TURN,
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

const REVIEW: TaskRequest = {
  tenant: 'acme',
  profile: 'review-client',
  draft: 'Review how this client is set up.',
  seq: 1,
};
const FIELD = { name: 'Message to the assistant' };

it('starts a conversation for the task with its question ready, and the person sends it', async () => {
  const user = userEvent.setup();
  const { sent } = await renderPanel(
    { [`POST ${CONVERSATIONS}/c1/messages`]: wholeStream(...TEXT_TURN) },
    { task: REVIEW },
  );

  expect(screen.getByRole('textbox', FIELD)).toHaveValue('Review how this client is set up.');
  expect(screen.getByText('Task')).toBeVisible();
  expect(screen.getByText('Review this client')).toBeVisible();
  expect(sent.some((request) => request.method === 'POST')).toBe(false);

  await user.type(screen.getByRole('textbox', FIELD), '{Enter}');
  await waitFor(() => {
    expect(sent.some((request) => request.path === CONVERSATIONS)).toBe(true);
  });
  expect(sent.find((request) => request.path === CONVERSATIONS)?.body).toMatchObject({
    profile: 'review-client',
    mode: 'ask',
    page_context: { route: '/clients/c1', objectType: 'client', objectId: 'c1' },
  });
});

it('asks the server for no earlier conversation to show instead', async () => {
  const { sent } = await renderPanel({}, { task: REVIEW });
  expect(sent.some((request) => request.path.endsWith('/last-conversation'))).toBe(false);
});

it('keeps the mode at Ask for a task, which only reads', async () => {
  await renderPanel({}, { task: REVIEW });
  expect(screen.getByRole('radio', { name: 'Act' })).toBeDisabled();
});

it('leaves the mode to the person in free chat', async () => {
  await renderPanel({});
  expect(screen.getByRole('radio', { name: 'Act' })).toBeEnabled();
});

it('is a new conversation when a task is asked for again, ending an answer that was running', async () => {
  const user = userEvent.setup();
  const stream = openStream();
  const { sent, host } = await renderPanel({
    [`POST ${CONVERSATIONS}/c1/messages`]: stream.answer,
    [`POST ${CONVERSATIONS}/c1/stop`]: json({ stopped: true }),
  });
  await user.type(screen.getByRole('textbox', FIELD), 'Go');
  await user.keyboard('{Enter}');
  stream.push(event({ type: 'start', messageId: 'a1' }));
  await screen.findByRole('button', { name: 'Stop' });

  act(() => {
    host.ask({ ...REVIEW, seq: 2 });
  });

  await waitFor(() => {
    expect(sent.some((request) => request.path === `${CONVERSATIONS}/c1/stop`)).toBe(true);
  });
  expect(await screen.findByText('Review this client')).toBeVisible();
  expect(screen.getByRole('textbox', FIELD)).toHaveValue('Review how this client is set up.');
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
});

it('keeps a message the person had begun, and says so, when a task is asked for', async () => {
  const user = userEvent.setup();
  const { host } = await renderPanel({});
  await user.type(screen.getByRole('textbox', FIELD), 'Why is it');
  act(() => {
    host.ask(REVIEW);
  });
  expect(await screen.findByText('Review this client')).toBeVisible();
  expect(screen.getByRole('textbox', FIELD)).toHaveValue('Why is it');
  expect(screen.getByRole('note')).toHaveTextContent('is kept');
});

it('fills in the question when the field was empty, with no word about a kept message', async () => {
  const { host } = await renderPanel({});
  act(() => {
    host.ask(REVIEW);
  });
  expect(await screen.findByText('Review this client')).toBeVisible();
  expect(screen.getByRole('textbox', FIELD)).toHaveValue('Review how this client is set up.');
  expect(screen.queryByRole('note')).toBeNull();
});

it('says where the stopped answer went', async () => {
  const user = userEvent.setup();
  const stream = openStream();
  const { host } = await renderPanel({
    [`POST ${CONVERSATIONS}/c1/messages`]: stream.answer,
    [`POST ${CONVERSATIONS}/c1/stop`]: json({ stopped: true }),
  });
  await user.type(screen.getByRole('textbox', FIELD), 'Go');
  await user.keyboard('{Enter}');
  stream.push(event({ type: 'start', messageId: 'a1' }));
  await screen.findByRole('button', { name: 'Stop' });
  act(() => {
    host.ask(REVIEW);
  });
  expect(await screen.findByRole('note')).toHaveTextContent('saved under Conversations');
});

it('goes back to free chat when the person starts a new conversation', async () => {
  const user = userEvent.setup();
  await renderPanel(
    { [`POST ${CONVERSATIONS}/c1/messages`]: wholeStream(...TEXT_TURN) },
    { task: REVIEW },
  );
  await user.type(screen.getByRole('textbox', FIELD), '{Enter}');
  await screen.findByText('three');
  expect(screen.getByText('Review this client')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'New conversation' }));
  await waitFor(() => {
    expect(screen.queryByText('Review this client')).toBeNull();
  });
  expect(screen.getByRole('radio', { name: 'Act' })).toBeEnabled();
});

it('has nothing axe finds, with a task chosen', async () => {
  expect(
    await axeInBothThemes(
      () => panelElement({}, { task: REVIEW }).element,
      () => screen.findByText('Review this client'),
    ),
  ).toEqual({ light: [], dark: [] });
});
