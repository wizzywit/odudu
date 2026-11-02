import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { ROW_BUDGET } from '#/shared/services/resourceList';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { inTurn, json, pending, problem } from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { emailRoutes, MAIL, mailMessage } from '#/testing/settingsFixtures';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/email';
const MESSAGES = [
  mailMessage('m3', 'failed', { attempts: 5, last_error: 'connect ECONNREFUSED' }),
  mailMessage('m2', 'sent'),
  mailMessage('m1', 'queued', { created_at: '2026-10-11T07:00:00.000Z' }),
];

function panel() {
  return screen.findByRole('region', { name: 'Delivery' });
}

it('lists the latest mail with its status, attempts, last error and when', async () => {
  renderConsoleAt(AT, emailRoutes(undefined, { [`GET ${MAIL}`]: json({ items: MESSAGES }) }));
  await panel();
  const table = await screen.findByRole('grid', { name: 'Mail of acme' });
  const rows = within(table).getAllByRole('row');
  const failed = rows.find((row) => row.textContent.includes('ECONNREFUSED'));
  expect(failed).toBeDefined();
  expect(failed).toHaveTextContent('failed');
  expect(failed).toHaveTextContent('5 attempts');
  expect(failed).toHaveTextContent('gave up');
  expect(rows.some((row) => row.textContent.includes('next try'))).toBe(true);
  expect(rows.some((row) => row.textContent.includes('sent'))).toBe(true);
  expect(within(table).getAllByText('Verify your Acme account')).toHaveLength(3);
});

it('reads one bounded page, and names the oldest message still waiting once all are read', async () => {
  const { sent } = renderConsoleAt(
    AT,
    emailRoutes(undefined, { [`GET ${MAIL}`]: json({ items: MESSAGES }) }),
  );
  expect(await screen.findByText(/Oldest message still waiting/u)).toBeVisible();
  const reads = sent.filter((s) => s.path === MAIL);
  expect(reads).toHaveLength(1);
  expect(reads[0]?.search.get('limit')).toBe('20');
  expect(reads[0]?.search.has('status')).toBe(false);
});

it('says nothing of the oldest waiting while more pages are unread, and loads them on request', async () => {
  const user = userEvent.setup();
  const first = json({ items: [MESSAGES[0]], next: 'c2' });
  const second = json({ items: [MESSAGES[2]] });
  renderConsoleAt(
    AT,
    emailRoutes(undefined, {
      [`GET ${MAIL}`]: (request) =>
        request.search.get('cursor') === 'c2' ? second(request) : first(request),
    }),
  );
  await screen.findByRole('grid', { name: 'Mail of acme' });
  expect(screen.queryByText(/Oldest message still waiting/u)).toBeNull();
  await user.click(await screen.findByRole('button', { name: 'Load more messages' }));
  await waitFor(() => {
    expect(within(screen.getByRole('grid')).getAllByRole('row')).toHaveLength(3);
  });
  expect(await screen.findByText(/Oldest message still waiting/u)).toBeVisible();
});

it('asks the server for one status, and for any when none is chosen', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    emailRoutes(undefined, { [`GET ${MAIL}`]: json({ items: MESSAGES }) }),
  );
  await screen.findByRole('grid', { name: 'Mail of acme' });
  await user.click(screen.getByRole('button', { name: /Show/u }));
  await user.click(await screen.findByRole('option', { name: 'Failed' }));
  await waitFor(() => {
    expect(sent.some((s) => s.path === MAIL && s.search.get('status') === 'failed')).toBe(true);
  });
});

it('reads the mail again on Refresh, and only then', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    emailRoutes(undefined, {
      [`GET ${MAIL}`]: inTurn(json({ items: [MESSAGES[2]] }), json({ items: MESSAGES })),
    }),
  );
  await screen.findByRole('grid', { name: 'Mail of acme' });
  expect(sent.filter((s) => s.path === MAIL)).toHaveLength(1);
  await user.click(within(await panel()).getByRole('button', { name: 'Refresh' }));
  await waitFor(() => {
    expect(within(screen.getByRole('grid')).getAllByRole('row')).toHaveLength(4);
  });
  expect(sent.filter((s) => s.path === MAIL)).toHaveLength(2);
});

it('says the recipients are shortened unless the caller may read subjects', async () => {
  renderConsoleAt(AT, emailRoutes(undefined, { [`GET ${MAIL}`]: json({ items: MESSAGES }) }));
  expect(await screen.findByText(/Holding view-users shows them whole/u)).toBeVisible();
  expect(screen.getAllByText('a***@example.org').length).toBeGreaterThan(0);
});

it('shows addresses given whole without the note about shortening', async () => {
  renderConsoleAt(
    AT,
    emailRoutes(undefined, {
      [`GET ${MAIL}`]: json({
        items: [mailMessage('m1', 'sent', { to: 'ada@example.org', to_masked: false })],
      }),
    }),
  );
  await screen.findByRole('grid', { name: 'Mail of acme' });
  expect(screen.getByText('ada@example.org')).toBeVisible();
  expect(screen.queryByText(/Holding view-users/u)).toBeNull();
});

it('says there is no mail, honestly, when the list is empty', async () => {
  renderConsoleAt(AT, emailRoutes());
  expect(await screen.findByText('This tenant has no mail of that status.')).toBeVisible();
});

it('says the mail could not be loaded, and tries again on request', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    emailRoutes(undefined, {
      [`GET ${MAIL}`]: inTurn(problem(500, 'about:blank', 'Error'), json({ items: MESSAGES })),
    }),
  );
  expect(await screen.findByText('The mail could not be loaded')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('grid', { name: 'Mail of acme' })).toBeVisible();
});

it('names the capability a refused read needs, rather than showing a failure', async () => {
  renderConsoleAt(
    AT,
    emailRoutes(undefined, { [`GET ${MAIL}`]: problem(403, 'about:blank', 'Forbidden') }),
  );
  const note = await within(await panel()).findByRole('note');
  expect(note).toHaveTextContent('Delivery needs the manage-tenant capability.');
});

it('holds the Load more button while the next page is on its way', async () => {
  const user = userEvent.setup();
  const first = json({ items: [MESSAGES[0]], next: 'c2' });
  renderConsoleAt(
    AT,
    emailRoutes(undefined, {
      [`GET ${MAIL}`]: (request) =>
        request.search.get('cursor') === 'c2' ? pending()(request) : first(request),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Load more messages' }));
  expect(await screen.findByRole('button', { name: 'Loading more messages…' })).toBeDisabled();
});

it('says the list cannot load further instead of offering a Load more that does nothing', async () => {
  const user = userEvent.setup();
  const rows = (from: number) =>
    Array.from({ length: ROW_BUDGET / 2 }, (_, index) =>
      mailMessage(`m${String(from + index)}`, 'sent'),
    );
  renderConsoleAt(
    AT,
    emailRoutes(undefined, {
      [`GET ${MAIL}`]: (request) =>
        json(
          request.search.get('cursor') === 'c2'
            ? { items: rows(ROW_BUDGET / 2), next: 'c3' }
            : { items: rows(0), next: 'c2' },
        )(request),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Load more messages' }));
  expect(await screen.findByText(/Narrow it to see further/u)).toBeVisible();
  expect(screen.queryByRole('button', { name: /Load more messages/u })).toBeNull();
});

it('passes axe in both themes with mail, empty and failed', async () => {
  for (const answer of [
    json({ items: MESSAGES }),
    json({ items: [] }),
    problem(500, 'about:blank', 'Error'),
  ]) {
    expect(
      await axeInBothThemes(
        () => consoleAt(AT, emailRoutes(undefined, { [`GET ${MAIL}`]: answer })).element,
        async () => {
          await panel();
          await waitFor(() => {
            expect(screen.queryByRole('status', { name: /Loading messages/u })).toBeNull();
          });
        },
      ),
    ).toEqual({ light: [], dark: [] });
  }
});
