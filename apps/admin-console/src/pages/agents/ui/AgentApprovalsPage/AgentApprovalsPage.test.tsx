import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { AGENT_APPROVALS, agentRoutes } from '#/testing/agentsFixtures';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { inTurn, json, pending, problem } from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';

afterEach(() => {
  resetConsole();
});

const AT = '/console/acme/agents/approvals';

it('lists what agents asked a person to approve, with its state and how it was answered', async () => {
  renderConsoleAt(AT, agentRoutes());
  expect(await screen.findByRole('heading', { level: 1, name: 'Agent approvals' })).toBeVisible();
  const table = await screen.findByRole('grid', { name: 'Agent approvals' });
  const pendingRow = within(table).getByRole('row', { name: /Delete the client reports/u });
  expect(pendingRow).toHaveTextContent('pending');
  expect(pendingRow).toHaveTextContent('planner');
  expect(pendingRow).toHaveTextContent('Waiting for the person it is for');
  const denied = within(table).getByRole('row', { name: /Rotate the signing key/u });
  expect(denied).toHaveTextContent('denied');
  expect(denied).toHaveTextContent('Denied on the approval page');
  expect(within(table).queryByText(/digest/iu)).toBeNull();
});

it('links the owner for a caller who may read subjects, and only names it for one who may not', async () => {
  renderConsoleAt(AT, agentRoutes());
  const table = await screen.findByRole('grid', { name: 'Agent approvals' });
  expect(within(table).getAllByRole('link', { name: 'Open the owner ada' })[0]).toHaveAttribute(
    'href',
    '/console/acme/subjects/sub-ada',
  );
  resetConsole();
  renderConsoleAt(AT, agentRoutes(['manage-sessions']));
  const plain = await screen.findByRole('grid', { name: 'Agent approvals' });
  expect(within(plain).queryByRole('link')).toBeNull();
});

it('asks the server for the state chosen, and only that', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, agentRoutes());
  await screen.findByRole('grid', { name: 'Agent approvals' });
  await user.click(screen.getByRole('button', { name: /State/u }));
  await user.click(await screen.findByRole('option', { name: 'Pending' }));
  await waitFor(() => {
    expect(
      sent.some((s) => s.path === AGENT_APPROVALS && s.search.get('state') === 'pending'),
    ).toBe(true);
  });
});

it('says none was asked when none was, and while they load', async () => {
  renderConsoleAt(AT, agentRoutes(undefined, { [`GET ${AGENT_APPROVALS}`]: json({ items: [] }) }));
  expect(await screen.findByText('No approvals yet')).toBeVisible();
  expect(screen.getByText('No agent has asked for an approval in this tenant.')).toBeVisible();
  resetConsole();
  renderConsoleAt(AT, agentRoutes(undefined, { [`GET ${AGENT_APPROVALS}`]: pending() }));
  expect(await screen.findByText('Loading approvals')).toBeInTheDocument();
});

it('offers to try again when the approvals could not be read', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    agentRoutes(undefined, {
      [`GET ${AGENT_APPROVALS}`]: inTurn(problem(500, 'about:blank', 'Boom'), json({ items: [] })),
    }),
  );
  expect(await screen.findByText('Agent approvals could not be loaded')).toBeVisible();
  await user.click(screen.getByRole('button', { name: /try again/iu }));
  expect(await screen.findByText('No approvals yet')).toBeVisible();
});

it('links back to the agents, and tells a caller without manage-sessions what it needs', async () => {
  renderConsoleAt(AT, agentRoutes());
  expect(
    await within(await screen.findByRole('main')).findByRole('link', { name: 'Agents' }),
  ).toHaveAttribute('href', '/console/acme/agents');
  resetConsole();
  renderConsoleAt(AT, agentRoutes(['manage-tenant']));
  expect(await screen.findByRole('note')).toHaveTextContent(
    'Agent approvals needs the manage-sessions capability.',
  );
  expect(screen.queryByRole('grid')).toBeNull();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, agentRoutes()).element,
      async () => {
        await screen.findByRole('grid', { name: 'Agent approvals' });
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
