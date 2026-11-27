import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import {
  ACTIVITY,
  CONVERSATION_ID,
  FIRST,
  PERSON_ID,
  SECOND,
  activityRoutes,
  conversation,
} from '#/testing/assistantActivityFixtures';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { inTurn, json, pending, problem } from '#/testing/fakeTransport';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { resetConsole } from '#/testing/resetConsole';

afterEach(() => {
  resetConsole();
});

const AT = '/console/acme/assistant-activity';

it('lists each conversation with its person, tokens, outcome and what it kept', async () => {
  renderConsoleAt(AT, activityRoutes());
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Assistant activity' }),
  ).toBeVisible();
  const table = await screen.findByRole('grid', { name: 'Assistant activity' });
  const first = within(table).getByRole('row', { name: /Which clients use refresh tokens/u });
  expect(first).toHaveTextContent('ada');
  expect(first).toHaveTextContent('2,500');
  expect(first).toHaveTextContent('Answered');
  expect(first).toHaveTextContent('list_clients, get_client');
  expect(
    within(first).getByRole('link', { name: 'Replay Which clients use refresh tokens?' }),
  ).toHaveAttribute('href', `/console/acme/assistant-activity/${CONVERSATION_ID}`);
  const second = within(table).getByRole('row', { name: /Delete the stale reports client/u });
  expect(second).toHaveTextContent('Awaiting decision');
  expect(second).toHaveTextContent('1 change');
  expect(second).toHaveTextContent('Reported');
  expect(second).toHaveTextContent('Reported over 180 days ago');
  expect(second).toHaveTextContent(PERSON_ID);
});

it('draws no more than the one page the server sent, and asks for the next from its cursor', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    activityRoutes(undefined, {
      [`GET ${ACTIVITY}`]: (request) =>
        json(
          request.search.get('cursor') === null
            ? { items: [FIRST], next: 'c2' }
            : { items: [SECOND] },
        )(request),
    }),
  );
  const table = await screen.findByRole('grid', { name: 'Assistant activity' });
  expect(within(table).getAllByRole('row')).toHaveLength(2);
  await user.click(await screen.findByRole('button', { name: 'Load more assistant activity' }));
  await waitFor(() => {
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });
  expect(sent.filter((s) => s.path === ACTIVITY).map((s) => s.search.get('cursor'))).toEqual([
    null,
    'c2',
  ]);
});

it('sends the outcome and the kind chosen, and only those', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, activityRoutes());
  await screen.findByRole('grid', { name: 'Assistant activity' });
  await user.click(screen.getByRole('button', { name: /Last outcome/u }));
  await user.click(await screen.findByRole('option', { name: 'Failed' }));
  await waitFor(() => {
    expect(sent.some((s) => s.path === ACTIVITY && s.search.get('outcome') === 'error')).toBe(true);
  });
  await user.click(screen.getByRole('button', { name: /Kind of conversation/u }));
  await user.click(await screen.findByRole('option', { name: 'Answers a budget refused' }));
  await waitFor(() => {
    expect(
      sent.some(
        (s) =>
          s.path === ACTIVITY &&
          s.search.get('kind') === 'budget_refusal' &&
          s.search.get('outcome') === 'error',
      ),
    ).toBe(true);
  });
});

it('applies a tool and a person once whole, and explains one that is not', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, activityRoutes());
  await screen.findByRole('grid', { name: 'Assistant activity' });
  await user.type(screen.getByRole('textbox', { name: 'Tool' }), 'Not A Tool{Enter}');
  expect(
    await screen.findByText(
      'A tool name is lower-case words joined by underscores, like list_clients.',
    ),
  ).toBeVisible();
  expect(sent.some((s) => s.search.has('tool'))).toBe(false);
  await user.clear(screen.getByRole('textbox', { name: 'Tool' }));
  await user.type(screen.getByRole('textbox', { name: 'Tool' }), 'list_clients{Enter}');
  await waitFor(() => {
    expect(sent.some((s) => s.path === ACTIVITY && s.search.get('tool') === 'list_clients')).toBe(
      true,
    );
  });
  await user.type(screen.getByRole('textbox', { name: 'Person (id)' }), `${PERSON_ID}{Enter}`);
  await waitFor(() => {
    expect(sent.some((s) => s.search.get('person') === PERSON_ID)).toBe(true);
  });
});

it('narrows to one person from their row', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, activityRoutes());
  const table = await screen.findByRole('grid', { name: 'Assistant activity' });
  const first = within(table).getByRole('row', { name: /Which clients use refresh tokens/u });
  await user.click(within(first).getByRole('button', { name: 'Show only ada’s conversations' }));
  await waitFor(() => {
    expect(sent.some((s) => s.path === ACTIVITY && s.search.get('person') === PERSON_ID)).toBe(
      true,
    );
  });
  expect(screen.getByRole('textbox', { name: 'Person (id)' })).toHaveValue(PERSON_ID);
});

it('links the person for a caller who may read subjects, and only names them for one who may not', async () => {
  renderConsoleAt(AT, activityRoutes());
  const table = await screen.findByRole('grid', { name: 'Assistant activity' });
  expect(within(table).getAllByRole('link', { name: 'ada, open the subject' })[0]).toHaveAttribute(
    'href',
    `/console/acme/subjects/${PERSON_ID}`,
  );
  resetConsole();
  renderConsoleAt(AT, activityRoutes(['read-assistant-activity']));
  const plain = await screen.findByRole('grid', { name: 'Assistant activity' });
  expect(within(plain).queryByRole('link', { name: /open the subject/u })).toBeNull();
});

it('says nobody has asked when nothing is listed, and while it loads', async () => {
  renderConsoleAt(AT, activityRoutes(undefined, { [`GET ${ACTIVITY}`]: json({ items: [] }) }));
  expect(await screen.findByText('No conversations yet')).toBeVisible();
  expect(
    screen.getByText('Nobody in this tenant has asked the assistant anything yet.'),
  ).toBeVisible();
  resetConsole();
  renderConsoleAt(AT, activityRoutes(undefined, { [`GET ${ACTIVITY}`]: pending() }));
  expect(await screen.findByText('Loading conversations')).toBeInTheDocument();
});

it('offers to try again when the list could not be read', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    activityRoutes(undefined, {
      [`GET ${ACTIVITY}`]: inTurn(
        problem(500, 'about:blank', 'Boom'),
        json({ items: [conversation('c-1', { title: 'Back again' })] }),
      ),
    }),
  );
  expect(await screen.findByText('Assistant activity could not be loaded')).toBeVisible();
  await user.click(screen.getByRole('button', { name: /try again/iu }));
  expect(await screen.findByText('Back again')).toBeVisible();
});

it('tells a caller without read-assistant-activity what it needs, and lists no entry for it', async () => {
  renderConsoleAt(AT, activityRoutes(['manage-tenant']));
  expect(await screen.findByRole('note')).toHaveTextContent(
    'Assistant activity needs the read-assistant-activity capability.',
  );
  expect(screen.queryByRole('grid')).toBeNull();
  expect(screen.queryByRole('link', { name: 'Assistant activity' })).toBeNull();
});

it('lists the entry beside the audit trail only for a reader in a deployment with an assistant', async () => {
  renderConsoleAt('/console/acme', activityRoutes(['read-assistant-activity', 'view-audit']));
  expect(await screen.findByRole('link', { name: 'Assistant activity' })).toHaveAttribute(
    'href',
    '/console/acme/assistant-activity',
  );
  resetConsole();
  renderConsoleAt(
    '/console/acme',
    activityRoutes(['read-assistant-activity', 'view-audit'], {}, false),
  );
  expect(await screen.findByRole('link', { name: 'Audit trail' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Assistant activity' })).toBeNull();
});

it('is not a page where the deployment has no assistant', async () => {
  renderConsoleAt(AT, activityRoutes(undefined, {}, false));
  expect(await screen.findByText(/page not found|not found/iu)).toBeVisible();
  expect(screen.queryByRole('grid')).toBeNull();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, activityRoutes()).element,
      async () => {
        await screen.findByRole('grid', { name: 'Assistant activity' });
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
