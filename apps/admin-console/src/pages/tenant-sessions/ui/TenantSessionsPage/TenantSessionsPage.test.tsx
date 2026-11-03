import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { inTurn, json, problem } from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import {
  SESSION_ADA,
  SESSION_NAMELESS,
  SESSIONS,
  sessionRoutes,
} from '#/testing/tenantSessionsFixtures';

afterEach(() => {
  resetConsole();
});

const AT = '/console/acme/sessions';

it('lists the tenant’s sessions with their subject, clients and times', async () => {
  renderConsoleAt(AT, sessionRoutes());
  expect(await screen.findByRole('heading', { level: 1, name: 'Sessions' })).toBeVisible();
  const table = await screen.findByRole('grid', { name: 'Sessions' });
  const ada = within(table).getByRole('row', { name: /ada/u });
  expect(within(ada).getByRole('link', { name: 'ada, open the subject' })).toHaveAttribute(
    'href',
    '/console/acme/subjects/sub-s-ada',
  );
  expect(ada).toHaveTextContent('odudu-admin');
  expect(ada).toHaveTextContent('no');
  const bot = within(table).getByRole('row', { name: /sub-s-bot/u });
  expect(bot).toHaveTextContent('none');
  expect(bot).toHaveTextContent('yes');
});

it('names the subject without a link to a caller who may not read subjects', async () => {
  renderConsoleAt(AT, sessionRoutes(['manage-sessions']));
  const table = await screen.findByRole('grid', { name: 'Sessions' });
  expect(within(table).getByText('ada')).toBeVisible();
  expect(within(table).queryByRole('link')).toBeNull();
});

it('says nobody is signed in when no session is live, and offers no end', async () => {
  renderConsoleAt(AT, sessionRoutes(undefined, { [`GET ${SESSIONS}`]: json({ items: [] }) }));
  expect(await screen.findByText('No sessions yet')).toBeVisible();
  expect(screen.getByRole('button', { name: 'End every session' })).toBeDisabled();
});

it('reads one page at a time, from the cursor the server gave', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    sessionRoutes(undefined, {
      [`GET ${SESSIONS}`]: (request) =>
        json(
          request.search.get('cursor') === null
            ? { items: [SESSION_ADA], next: 'c2' }
            : { items: [SESSION_NAMELESS] },
        )(request),
    }),
  );
  await screen.findByRole('grid', { name: 'Sessions' });
  await user.click(await screen.findByRole('button', { name: 'Load more sessions' }));
  await waitFor(() => {
    expect(sent.some((s) => s.path === SESSIONS && s.search.get('cursor') === 'c2')).toBe(true);
  });
  expect(await screen.findByRole('row', { name: /sub-s-bot/u })).toBeVisible();
});

it('ends every session once the tenant’s name is typed, and says what came of it', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    sessionRoutes(undefined, {
      [`GET ${SESSIONS}`]: inTurn(
        json({ items: [SESSION_ADA, SESSION_NAMELESS] }),
        json({ items: [] }),
      ),
      [`DELETE ${SESSIONS}`]: json({ ended: 2, remaining: 0, beyond_ceiling: 1 }),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'End every session' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'End every session in acme?' });
  expect(dialog).toHaveTextContent('Every live session in acme ends, whoever holds it');
  expect(dialog).toHaveTextContent('Your own console session is one of them');
  const confirm = within(dialog).getByRole('button', { name: 'End every session' });
  expect(confirm).toBeDisabled();
  await user.type(within(dialog).getByRole('textbox', { name: 'Type acme to confirm' }), 'acme');
  await user.click(confirm);
  expect(await screen.findByText(/2 sessions in acme ended\. 1 was left alone/u)).toBeVisible();
  expect(sent.filter((s) => s.method === 'DELETE')).toHaveLength(1);
  expect(await screen.findByText('No sessions yet')).toBeVisible();
});

it('keeps saying to end again beside the button while more sessions are live', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    sessionRoutes(undefined, {
      [`DELETE ${SESSIONS}`]: json({ ended: 500, remaining: 12, beyond_ceiling: 0 }),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'End every session' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.type(within(dialog).getByRole('textbox'), 'acme{Enter}');
  expect(
    await screen.findByText(
      'More sessions are still live in acme: end every session again to end the next 500.',
    ),
  ).toBeVisible();
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('keeps the dialog and says why when the server refuses', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    sessionRoutes(undefined, {
      [`DELETE ${SESSIONS}`]: problem(403, 'about:blank', 'Forbidden'),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'End every session' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.type(within(dialog).getByRole('textbox'), 'acme{Enter}');
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('manage-sessions');
});

it('tells a caller without manage-sessions what the page needs, and draws no list', async () => {
  renderConsoleAt(AT, sessionRoutes(['manage-tenant']));
  expect(await screen.findByRole('note')).toHaveTextContent(
    'Sessions needs the manage-sessions capability.',
  );
  expect(screen.queryByRole('grid')).toBeNull();
  expect(screen.queryByRole('button', { name: 'End every session' })).toBeNull();
});

it('passes axe in both themes, with the list and with the confirmation open', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, sessionRoutes()).element,
      async () => {
        await screen.findByRole('grid', { name: 'Sessions' });
      },
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, sessionRoutes()).element,
      async () => {
        await user.click(await screen.findByRole('button', { name: 'End every session' }));
        await screen.findByRole('alertdialog', { name: 'End every session in acme?' });
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
