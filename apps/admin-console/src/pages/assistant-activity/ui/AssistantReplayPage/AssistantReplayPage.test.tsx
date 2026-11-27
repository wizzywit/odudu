import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  CONVERSATION_ID,
  PROMPTFOO,
  REPLAY,
  REPORT,
  activityRoutes,
  replay,
} from '#/testing/assistantActivityFixtures';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { inTurn, json, pending, problem } from '#/testing/fakeTransport';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { resetConsole } from '#/testing/resetConsole';
import { toastsShown } from '#/testing/toastsShown';

const saved: { name: string; type: string }[] = [];

beforeEach(() => {
  saved.length = 0;
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ name: this.download, type: '' });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetConsole();
});

const AT = `/console/acme/assistant-activity/${CONVERSATION_ID}`;

async function opened() {
  return screen.findByRole('article', { name: 'Answer 1' });
}

it('replays every step with its model, tokens, call and result', async () => {
  renderConsoleAt(AT, activityRoutes());
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Conversation replay' }),
  ).toBeVisible();
  const turn = await opened();
  const steps = within(turn)
    .getAllByRole('listitem')
    .filter((li) => li.textContent.startsWith('Step'));
  expect(steps).toHaveLength(2);
  expect(steps[0]).toHaveTextContent('Step 1');
  expect(steps[0]).toHaveTextContent('standard · standard-1');
  expect(steps[0]).toHaveTextContent('1,200 in · 80 out');
  expect(steps[0]).toHaveTextContent('2.5 s');
  expect(steps[0]).toHaveTextContent('Called list_clients');
  expect(steps[0]).toHaveTextContent('"limit": 10');
  expect(steps[0]).toHaveTextContent('Result of list_clients');
  expect(steps[0]).toHaveTextContent('41 ms');
  expect(steps[1]).toHaveTextContent('1,500 in · 300 out');
  expect(steps[1]).toHaveTextContent('Only the web client does.');
});

it('says why this model and why it stopped, and what was decided of each change', async () => {
  renderConsoleAt(AT, activityRoutes());
  const turn = await opened();
  expect(turn).toHaveTextContent('Why this model');
  expect(turn).toHaveTextContent('standard: mock/standard-1 because the profile asks for it');
  expect(turn).toHaveTextContent('Why it stopped. The model finished its answer.');
  expect(turn).toHaveTextContent('Chose the standard model');
  const changes = screen.getByRole('region', { name: 'Changes the assistant proposed' });
  const row = within(changes).getByRole('row', { name: /Delete the client reports/u });
  expect(row).toHaveTextContent('delete_client');
  expect(row).toHaveTextContent('client reports');
  expect(row).toHaveTextContent('denied');
});

it('shows what was asked, and a note instead where the tenant keeps text from auditors', async () => {
  renderConsoleAt(AT, activityRoutes());
  expect(await screen.findByText('Which clients use refresh tokens?')).toBeVisible();
  expect(screen.queryByRole('note')).toBeNull();
  resetConsole();
  renderConsoleAt(
    AT,
    activityRoutes(undefined, {
      [`GET ${REPLAY}`]: json(replay({ text_visible: false, asked: [] })),
    }),
  );
  expect(await screen.findByRole('note')).toHaveTextContent(
    'does not let people who hold read-assistant-activity read what was said',
  );
  expect(screen.queryByText('Which clients use refresh tokens?')).toBeNull();
});

it('draws a long turn a hundred entries at a time', async () => {
  const user = userEvent.setup();
  const many = replay();
  const turn = many.turns[0];
  const events = Array.from({ length: 230 }, (_, seq) => ({
    seq,
    step_id: null,
    kind: 'narrowing',
    at: '2026-11-25T08:00:00.000Z',
    payload: { mode: 'ask', writes: seq },
  }));
  renderConsoleAt(
    AT,
    activityRoutes(undefined, {
      [`GET ${REPLAY}`]: json({ ...many, turns: [{ ...turn, events }] }),
    }),
  );
  const card = await opened();
  expect(within(card).getAllByText('Narrowed the tools')).toHaveLength(100);
  expect(card).toHaveTextContent('130 more entries are not shown.');
  await user.click(within(card).getByRole('button', { name: 'Show 100 more' }));
  expect(within(card).getAllByText('Narrowed the tools')).toHaveLength(200);
  await user.click(within(card).getByRole('button', { name: 'Show 30 more' }));
  expect(within(card).getAllByText('Narrowed the tools')).toHaveLength(230);
});

it('opens only the latest answer, and each other one on request', async () => {
  const user = userEvent.setup();
  const base = replay();
  const first = base.turns[0];
  const second = { ...first, id: 'turn-2', steps: [], events: [], why_stopped: 'Second.' };
  renderConsoleAt(
    AT,
    activityRoutes(undefined, {
      [`GET ${REPLAY}`]: json({ ...base, turns: [first, second], turns_omitted: 3 }),
    }),
  );
  expect(await screen.findByText(/3 earlier answers are not shown/u)).toBeVisible();
  const latest = await screen.findByRole('article', { name: 'Answer 5' });
  expect(within(latest).getByRole('button', { name: /Hide the steps/u })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  const older = screen.getByRole('article', { name: 'Answer 4' });
  expect(within(older).getByRole('button', { name: /Show the steps/u })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  expect(within(older).queryByText('Called list_clients')).toBeNull();
  await user.click(within(older).getByRole('button', { name: /Show the steps/u }));
  expect(await within(older).findByText('Called list_clients')).toBeVisible();
});

it('saves the test case under the file name the API gives it', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, activityRoutes());
  await opened();
  await user.click(screen.getByRole('button', { name: 'Export as test case' }));
  await waitFor(() => {
    expect(saved).toEqual([{ name: `assistant-${CONVERSATION_ID}.promptfoo.json`, type: '' }]);
  });
  expect(sent.some((s) => s.path === PROMPTFOO)).toBe(true);
  expect(toastsShown()).toContain(`Saved assistant-${CONVERSATION_ID}.promptfoo.json.`);
});

it('says so when the test case could not be exported, and saves nothing', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    activityRoutes(undefined, { [`GET ${PROMPTFOO}`]: problem(404, 'about:blank', 'Not Found') }),
  );
  await opened();
  await user.click(screen.getByRole('button', { name: 'Export as test case' }));
  await waitFor(() => {
    expect(toastsShown()).toContain('This conversation is no longer there.');
  });
  expect(saved).toEqual([]);
});

it('reports the conversation once, and holds the control afterwards', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, activityRoutes());
  await opened();
  await user.click(screen.getByRole('button', { name: 'Report this answer' }));
  const reported = await screen.findByRole('button', { name: 'Reported' });
  expect(reported).toBeDisabled();
  expect(sent.filter((s) => s.method === 'POST' && s.path === REPORT)).toHaveLength(1);
});

it('says how many reports the tenant keeps once it is near the limit', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    activityRoutes(undefined, {
      [`POST ${REPORT}`]: json({
        reported_at: '2026-11-25T09:00:00.000Z',
        reported_count: 84,
        near_limit: true,
      }),
    }),
  );
  await opened();
  await user.click(screen.getByRole('button', { name: 'Report this answer' }));
  expect(
    await screen.findByText('This tenant now keeps 84 of 100 reported conversations.'),
  ).toBeVisible();
});

it('holds the report control with the stated reason once the tenant is at its cap', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    activityRoutes(undefined, {
      [`POST ${REPORT}`]: problem(409, 'about:blank', 'Conflict', {
        detail: 'this tenant already keeps as many reported conversations as it may',
      }),
    }),
  );
  await opened();
  await user.click(screen.getByRole('button', { name: 'Report this answer' }));
  const reason =
    'This tenant already keeps 100 reported conversations, the most it may, so this one was not reported.';
  expect(await screen.findByText(reason)).toBeVisible();
  const button = screen.getByRole('button', { name: 'Report this answer' });
  expect(button).toBeDisabled();
  expect(button).toHaveAccessibleDescription(reason);
  expect(sent.filter((s) => s.method === 'POST' && s.path === REPORT)).toHaveLength(1);
});

it('offers the report as already made for a conversation that was reported before', async () => {
  const done = replay();
  renderConsoleAt(
    AT,
    activityRoutes(undefined, {
      [`GET ${REPLAY}`]: json({
        ...done,
        conversation: { ...done.conversation, reported_at: '2026-11-20T00:00:00.000Z' },
      }),
    }),
  );
  await opened();
  expect(screen.getByRole('button', { name: 'Reported' })).toBeDisabled();
});

it('offers to try again when the replay could not be read, and loads while it is read', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    activityRoutes(undefined, {
      [`GET ${REPLAY}`]: inTurn(problem(500, 'about:blank', 'Boom'), json(replay())),
    }),
  );
  expect(await screen.findByText('The conversation could not be loaded')).toBeVisible();
  await user.click(screen.getByRole('button', { name: /try again/iu }));
  await opened();
  resetConsole();
  renderConsoleAt(AT, activityRoutes(undefined, { [`GET ${REPLAY}`]: pending() }));
  expect(await screen.findByText('Loading the conversation')).toBeInTheDocument();
});

it('leads back to the list, and is refused with its need named for a caller without the capability', async () => {
  renderConsoleAt(AT, activityRoutes());
  expect(await screen.findByRole('link', { name: 'Assistant activity' })).toHaveAttribute(
    'href',
    '/console/acme/assistant-activity',
  );
  resetConsole();
  renderConsoleAt(AT, activityRoutes(['manage-tenant']));
  expect(await screen.findByRole('note')).toHaveTextContent(
    'needs the read-assistant-activity capability',
  );
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, activityRoutes()).element,
      async () => {
        await opened();
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
