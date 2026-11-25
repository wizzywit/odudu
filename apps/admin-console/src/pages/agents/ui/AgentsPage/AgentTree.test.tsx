import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { AGENTS, agent, agentRoutes } from '#/testing/agentsFixtures';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { json } from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';

afterEach(() => {
  resetConsole();
});

const AT = '/console/acme/agents';

const LINEAGE = {
  [`GET ${AGENTS}`]: json({
    items: [
      agent('run-a', null, { agent_client: 'planner' }),
      agent('run-b', 'run-a', { agent_client: 'writer', depth: 2 }),
      agent('run-c', 'run-b', { agent_client: 'checker', depth: 3 }),
      agent('run-d', 'run-b', { agent_client: 'linter', depth: 3, state: 'expired' }),
    ],
  }),
};

it('nests each run under the one that started it, as deep as the lineage goes', async () => {
  renderConsoleAt(AT, agentRoutes(undefined, LINEAGE));
  const top = await screen.findByRole('list', { name: 'Agents' });
  const writer = within(top).getByRole('list', { name: 'Started by the run of planner, run-a' });
  const beneath = within(writer).getByRole('list', { name: 'Started by the run of writer, run-b' });
  expect(
    within(beneath)
      .getAllByRole('listitem', { name: /, run-[cd]$/u })
      .map((item) => item.getAttribute('aria-label')),
  ).toEqual(['checker, run-c', 'linter, run-d']);
});

it('opens and closes the details of one run without touching its neighbours', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    agentRoutes(undefined, {
      ...LINEAGE,
      [`GET ${AGENTS}/run-c`]: json(agent('run-c', 'run-b', { agent_client: 'checker', depth: 3 })),
    }),
  );
  const top = await screen.findByRole('list', { name: 'Agents' });
  const open = within(top).getByRole('button', {
    name: 'Show details of the run of checker, run-c',
  });
  expect(open).toHaveAttribute('aria-expanded', 'false');
  await user.click(open);
  expect(await screen.findByText('Run id')).toBeVisible();
  expect(screen.getAllByText('Run id')).toHaveLength(1);
  const close = within(top).getByRole('button', {
    name: 'Hide details of the run of checker, run-c',
  });
  expect(close).toHaveAttribute('aria-expanded', 'true');
  await user.click(close);
  expect(screen.queryByText('Run id')).toBeNull();
});

it('passes axe in both themes with a lineage three levels deep and a run’s details open', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(
          AT,
          agentRoutes(undefined, {
            ...LINEAGE,
            [`GET ${AGENTS}/run-a`]: json(agent('run-a', null, { agent_client: 'planner' })),
          }),
        ).element,
      async () => {
        await user.click(
          await screen.findByRole('button', { name: 'Show details of the run of planner, run-a' }),
        );
        await screen.findByText('Run id');
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
