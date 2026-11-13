import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { json, problem } from '#/testing/fakeTransport';
import {
  DEFAULT_FLOW_ID,
  flowRecordBody,
  flowRoutes,
  FLS,
  STAFF_FLOW_ID,
} from '#/testing/flowFixtures';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = `/console/acme/flow/${STAFF_FLOW_ID}`;
const STAFF = `${FLS}/${STAFF_FLOW_ID}`;
const ONE_STEP = [{ authenticator: 'password', requirement: 'alternative' }];

function routes(extra: Record<string, ReturnType<typeof json>> = {}) {
  return flowRoutes(undefined, {
    [`GET ${STAFF}`]: json(flowRecordBody(STAFF_FLOW_ID, 'staff', false, ONE_STEP), 200, {
      etag: '"s1"',
    }),
    ...extra,
  });
}

async function section() {
  return screen.findByRole('region', { name: 'Steps' });
}

it('shows the flow’s name and steps, and offers the authenticators it does not have', async () => {
  renderConsoleAt(AT, routes());
  const region = await section();
  expect(within(region).getByRole('textbox', { name: /Name/u })).toHaveValue('staff');
  expect(
    within(within(region).getByRole('list', { name: 'Sign-in steps' })).getAllByRole('listitem'),
  ).toHaveLength(1);
  expect(within(region).getByRole('button', { name: 'Add step' })).toBeVisible();
});

it('renames the flow and replaces its steps on the ETag it was read with', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    routes({
      [`PUT ${STAFF}`]: json(flowRecordBody(STAFF_FLOW_ID, 'crew', false, ONE_STEP), 200, {
        etag: '"s2"',
      }),
    }),
  );
  const region = await section();
  const name = within(region).getByRole('textbox', { name: /Name/u });
  await user.clear(name);
  await user.type(name, 'crew');
  await user.click(within(region).getByRole('button', { name: 'Save Steps' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')).toMatchObject({
      ifMatch: '"s1"',
      body: { name: 'crew', steps: ONE_STEP },
    });
  });
});

it('says under the name that another flow holds it', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    routes({ [`PUT ${STAFF}`]: problem(409, 'about:blank#flow-name-taken', 'Conflict') }),
  );
  const region = await section();
  const name = within(region).getByRole('textbox', { name: /Name/u });
  await user.clear(name);
  await user.type(name, 'default');
  await user.click(within(region).getByRole('button', { name: 'Save Steps' }));
  expect(
    await screen.findByText('That name belongs to another flow of this tenant. Choose another.'),
  ).toBeVisible();
});

it('words a refused step list under the steps, naming the step', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    routes({
      [`PUT ${STAFF}`]: problem(400, 'about:blank#flow-duplicate-authenticator', 'Bad Request', {
        errors: [{ path: 'steps[0].authenticator', message: 'repeats an earlier step' }],
      }),
    }),
  );
  const region = await section();
  const name = within(region).getByRole('textbox', { name: /Name/u });
  await user.type(name, 'x');
  await user.click(within(region).getByRole('button', { name: 'Save Steps' }));
  expect(
    await screen.findByText('“password” is a step twice. An authenticator is one step.'),
  ).toBeVisible();
});

it('says the flow could not be loaded when it is gone', async () => {
  renderConsoleAt(
    `/console/acme/flow/${DEFAULT_FLOW_ID}`,
    flowRoutes(undefined, { [`GET ${FLS}/${DEFAULT_FLOW_ID}`]: problem(404) }),
  );
  expect(await screen.findByText('The flow could not be loaded')).toBeVisible();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, routes()).element,
      () => section(),
    ),
  ).toEqual({ light: [], dark: [] });
});
