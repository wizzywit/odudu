import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { AGENTS, RUN_CHILD, RUN_ROOT, agent, agentRoutes } from '#/testing/agentsFixtures';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { inTurn, json, pending, problem } from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';

afterEach(() => {
  resetConsole();
});

const AT = '/console/acme/agents';

it('draws the runs as a tree by lineage, each with its client, owner, budget and expiry', async () => {
  renderConsoleAt(AT, agentRoutes());
  expect(await screen.findByRole('heading', { level: 1, name: 'Agents' })).toBeVisible();
  const tree = await screen.findByRole('list', { name: 'Agents' });
  const root = within(tree).getByRole('listitem', { name: /planner/u });
  expect(root).toHaveTextContent('live');
  expect(root).toHaveTextContent('18 writes and 9 creates left');
  expect(root).toHaveTextContent('Expires');
  for (const link of within(root).getAllByRole('link', { name: 'Open the owner ada' })) {
    expect(link).toHaveAttribute('href', '/console/acme/subjects/sub-ada');
  }
  const under = within(root).getByRole('list', {
    name: 'Started by planner started 2026-11-25 08:00:00 UTC (run-root)',
  });
  expect(within(under).getByText('writer')).toBeVisible();
  const old = within(tree).getByRole('listitem', { name: /auditor/u });
  expect(old).toHaveTextContent('revoked');
  expect(old).toHaveTextContent('Revoked');
  expect(within(old).queryByText(/writes and/u)).toBeNull();
  expect(within(old).queryByRole('button', { name: /^Revoke the run/u })).toBeNull();
});

it('says a run whose parent is not on the loaded pages is started by one that is elsewhere', async () => {
  renderConsoleAt(
    AT,
    agentRoutes(undefined, {
      [`GET ${AGENTS}`]: json({ items: [agent('run-lost', 'run-gone-away', { depth: 2 })] }),
    }),
  );
  expect(
    await screen.findByText('Started by run one-away, which is not in this view.'),
  ).toBeVisible();
});

it('names the owner without a link to a caller who may not read subjects', async () => {
  renderConsoleAt(AT, agentRoutes(['manage-sessions']));
  const tree = await screen.findByRole('list', { name: 'Agents' });
  expect(within(tree).queryByRole('link')).toBeNull();
  expect(within(tree).getAllByText('sub-ada').length).toBeGreaterThan(0);
});

it('says no agent has acted when none has', async () => {
  renderConsoleAt(AT, agentRoutes(undefined, { [`GET ${AGENTS}`]: json({ items: [] }) }));
  expect(await screen.findByText('No agents yet')).toBeVisible();
  expect(screen.getByText(/No agent has acted in this tenant yet/u)).toBeVisible();
});

it('says while the runs are loading', async () => {
  renderConsoleAt(AT, agentRoutes(undefined, { [`GET ${AGENTS}`]: pending() }));
  expect(await screen.findByText('Loading agents')).toBeInTheDocument();
});

it('offers to try again when the runs could not be read', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    agentRoutes(undefined, {
      [`GET ${AGENTS}`]: inTurn(problem(500, 'about:blank', 'Boom'), json({ items: [RUN_ROOT] })),
    }),
  );
  expect(await screen.findByText('Agents could not be loaded')).toBeVisible();
  await user.click(screen.getByRole('button', { name: /try again/iu }));
  expect(await screen.findByRole('list', { name: 'Agents' })).toBeVisible();
});

it('narrows the runs by state, asking the server for that state alone', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, agentRoutes());
  await screen.findByRole('list', { name: 'Agents' });
  await user.click(screen.getByRole('button', { name: /State/u }));
  await user.click(await screen.findByRole('option', { name: 'Live' }));
  await waitFor(() => {
    expect(sent.some((s) => s.path === AGENTS && s.search.get('state') === 'live')).toBe(true);
  });
});

it('narrows the runs to one owner and offers the way back to every run', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, agentRoutes());
  await screen.findByRole('list', { name: 'Agents' });
  await user.click(screen.getByRole('button', { name: 'Only the runs acting for sub-bob' }));
  await waitFor(() => {
    expect(sent.some((s) => s.path === AGENTS && s.search.get('owner') === 'sub-bob')).toBe(true);
  });
  expect(await screen.findByText('Only the runs acting for sub-bob.')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Show every agent' }));
  await waitFor(() => {
    expect(screen.queryByText('Only the runs acting for sub-bob.')).toBeNull();
  });
});

it('reads one run again when its details are opened, and says when it could not be read', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    agentRoutes(undefined, {
      [`GET ${AGENTS}/run-root`]: json(RUN_ROOT),
      [`GET ${AGENTS}/run-child`]: problem(500, 'about:blank', 'Boom'),
    }),
  );
  const tree = await screen.findByRole('list', { name: 'Agents' });
  expect(sent.some((s) => s.path === `${AGENTS}/run-root`)).toBe(false);
  await user.click(
    within(tree).getByRole('button', {
      name: 'Show details of planner started 2026-11-25 08:00:00 UTC (run-root)',
    }),
  );
  expect(await screen.findByText('mcp:read mcp:write')).toBeVisible();
  await user.click(
    within(tree).getByRole('button', {
      name: 'Show details of writer started 2026-11-25 08:00:00 UTC (un-child)',
    }),
  );
  expect(await screen.findByText('The details of this run could not be read.')).toBeVisible();
});

it('links to the approvals and back', async () => {
  renderConsoleAt(AT, agentRoutes());
  expect(await screen.findByRole('link', { name: 'Approvals' })).toHaveAttribute(
    'href',
    '/console/acme/agents/approvals',
  );
});

it('says how many instances and grants a revoke ends before it ends them, then ends them', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    agentRoutes(undefined, {
      [`GET ${AGENTS}`]: inTurn(
        json({ items: [RUN_ROOT, RUN_CHILD] }),
        json({
          items: [
            { ...RUN_ROOT, state: 'revoked' },
            { ...RUN_CHILD, state: 'revoked' },
          ],
        }),
      ),
      [`DELETE ${AGENTS}/run-root`]: json({ grants: 2, instances: 2 }),
    }),
  );
  const tree = await screen.findByRole('list', { name: 'Agents' });
  await user.click(
    within(tree).getByRole('button', {
      name: 'Revoke planner started 2026-11-25 08:00:00 UTC (run-root)',
    }),
  );
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Revoke planner started 2026-11-25 08:00:00 UTC (run-root)?',
  });
  expect(
    await within(dialog).findByText(/ends 2 instances, this one and every run/u),
  ).toBeVisible();
  expect(dialog).toHaveTextContent('revokes 2 grants');
  expect(sent.filter((s) => s.method === 'DELETE').map((s) => s.search.get('dry_run'))).toEqual([
    'true',
  ]);
  await user.click(within(dialog).getByRole('button', { name: 'Revoke run' }));
  expect(
    await screen.findByText('The run of planner ended: 2 instances and 2 grants.'),
  ).toBeVisible();
  expect(sent.filter((s) => s.method === 'DELETE').map((s) => s.search.get('dry_run'))).toEqual([
    'true',
    null,
  ]);
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

it('holds the revoke while the count is read, and when it could not be read', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    agentRoutes(undefined, {
      [`DELETE ${AGENTS}/run-root`]: inTurn(
        problem(500, 'about:blank', 'Boom'),
        json({ grants: 0, instances: 1 }),
      ),
    }),
  );
  const tree = await screen.findByRole('list', { name: 'Agents' });
  await user.click(
    within(tree).getByRole('button', {
      name: 'Revoke planner started 2026-11-25 08:00:00 UTC (run-root)',
    }),
  );
  const dialog = await screen.findByRole('alertdialog');
  expect(
    await within(dialog).findByText(/could not be read, so the revoke is held/u),
  ).toBeVisible();
  expect(within(dialog).getByRole('button', { name: 'Revoke run' })).toBeDisabled();
  await user.click(within(dialog).getByRole('button', { name: 'Read again' }));
  expect(await within(dialog).findByText(/ends 1 instance, this one/u)).toBeVisible();
  expect(within(dialog).getByRole('button', { name: 'Revoke run' })).toBeEnabled();
});

it('keeps the dialog and says why when the server refuses the revoke', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    agentRoutes(undefined, {
      [`DELETE ${AGENTS}/run-root`]: (request) =>
        request.search.get('dry_run') === 'true'
          ? json({ grants: 1, instances: 1 })(request)
          : problem(403, 'about:blank', 'Forbidden')(request),
    }),
  );
  const tree = await screen.findByRole('list', { name: 'Agents' });
  await user.click(
    within(tree).getByRole('button', {
      name: 'Revoke planner started 2026-11-25 08:00:00 UTC (run-root)',
    }),
  );
  const dialog = await screen.findByRole('alertdialog');
  await user.click(await within(dialog).findByRole('button', { name: 'Revoke run' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('manage-sessions');
});

it('tells a caller without manage-sessions what the page needs, and draws no tree', async () => {
  renderConsoleAt(AT, agentRoutes(['manage-tenant']));
  expect(await screen.findByRole('note')).toHaveTextContent(
    'Agents needs the manage-sessions capability.',
  );
  expect(screen.queryByRole('list', { name: 'Agents' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Approvals' })).toBeNull();
});

it('passes axe in both themes, with the tree and with the confirmation open', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, agentRoutes()).element,
      async () => {
        await screen.findByRole('list', { name: 'Agents' });
      },
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(
          AT,
          agentRoutes(undefined, {
            [`DELETE ${AGENTS}/run-root`]: json({ grants: 1, instances: 2 }),
          }),
        ).element,
      async () => {
        await user.click(
          await screen.findByRole('button', {
            name: 'Revoke planner started 2026-11-25 08:00:00 UTC (run-root)',
          }),
        );
        await screen.findByText(/ends 2 instances/u);
      },
    ),
  ).toEqual({ light: [], dark: [] });
});

it('tells sibling runs of one client apart by their start and the end of their id', async () => {
  renderConsoleAt(
    AT,
    agentRoutes(undefined, {
      [`GET ${AGENTS}`]: json({
        items: [
          agent('0197a3b2-0000-7000-8000-00000000aaaa', null, {
            created_at: '2026-11-25T08:00:01.000Z',
          }),
          agent('0197a3b2-0000-7000-8000-00000000bbbb', null, {
            created_at: '2026-11-25T08:00:02.000Z',
          }),
        ],
      }),
    }),
  );
  const tree = await screen.findByRole('list', { name: 'Agents' });
  const names = within(tree)
    .getAllByRole('button', { name: /^Revoke planner/u })
    .map((button) => button.getAttribute('aria-label'));
  expect(new Set(names).size).toBe(2);
  expect(names[0]).toContain('(0000aaaa)');
});

it('shows the owner by username, or by the end of the id where it has none', async () => {
  renderConsoleAt(AT, agentRoutes());
  const tree = await screen.findByRole('list', { name: 'Agents' });
  const old = within(tree).getByRole('listitem', { name: /auditor/u });
  expect(within(tree).getAllByText('ada').length).toBeGreaterThan(0);
  expect(old).toHaveTextContent('sub-bob');
});

it('says what the last revoke came to in a status that takes the focus', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    agentRoutes(undefined, {
      [`DELETE ${AGENTS}/run-root`]: json({ grants: 1, instances: 1 }),
    }),
  );
  const tree = await screen.findByRole('list', { name: 'Agents' });
  await user.click(
    within(tree).getByRole('button', {
      name: 'Revoke planner started 2026-11-25 08:00:00 UTC (run-root)',
    }),
  );
  const dialog = await screen.findByRole('alertdialog');
  await user.click(await within(dialog).findByRole('button', { name: 'Revoke run' }));
  const status = await screen.findByRole('status', { name: 'Last revoke' });
  await waitFor(() => {
    expect(status).toHaveTextContent('The run of planner ended: 1 instance and 1 grant.');
    expect(status).toHaveFocus();
  });
});

it('holds the confirmation while the count is read for a reopened revoke, never offering a stale one', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    agentRoutes(undefined, {
      [`DELETE ${AGENTS}/run-root`]: inTurn(
        json({ grants: 1, instances: 1 }),
        json({ grants: 2, instances: 3 }),
      ),
    }),
  );
  const tree = await screen.findByRole('list', { name: 'Agents' });
  const open = (): Promise<void> =>
    user.click(
      within(tree).getByRole('button', {
        name: 'Revoke planner started 2026-11-25 08:00:00 UTC (run-root)',
      }),
    );
  await open();
  const first = await screen.findByRole('alertdialog');
  await within(first).findByText(/ends 1 instance,/u);
  await user.click(within(first).getByRole('button', { name: 'Cancel' }));
  await open();
  const again = await screen.findByRole('alertdialog');
  expect(within(again).queryByText(/ends 1 instance,/u)).toBeNull();
  await within(again).findByText(/ends 3 instances,/u);
  expect(within(again).getByRole('button', { name: 'Revoke run' })).toBeEnabled();
});
