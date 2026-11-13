import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { inTurn, problem } from '#/testing/fakeTransport';
import {
  DEFAULT_FLOW_ID,
  flowRoutes,
  FLS,
  FLOW_LIST,
  flowsAnswer,
  STAFF_FLOW_ID,
} from '#/testing/flowFixtures';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/flow';
const gone = () => new Response(null, { status: 204 });

async function table() {
  return screen.findByRole('grid', { name: 'Flows' });
}

it('lists the flows with the default marked, each with a way in, and no delete for the default', async () => {
  renderConsoleAt(AT, flowRoutes());
  const rows = await table();
  const fallback = within(rows).getByRole('row', { name: /default/u });
  expect(fallback).toHaveTextContent('Default');
  expect(fallback).toHaveTextContent('3 steps: passkey, password, otp');
  expect(within(fallback).getByRole('link', { name: 'Edit default' })).toHaveAttribute(
    'href',
    `/console/acme/flow/${DEFAULT_FLOW_ID}`,
  );
  expect(within(fallback).queryByRole('button', { name: /Delete/u })).toBeNull();
  const staff = within(rows).getByRole('row', { name: /staff/u });
  expect(within(staff).getByRole('button', { name: 'Delete staff' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'New flow' })).toHaveAttribute(
    'href',
    '/console/acme/flow/new',
  );
});

it('deletes a flow after asking, says so, and reads the list again', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    flowRoutes(undefined, {
      [`GET ${FLS}`]: inTurn(flowsAnswer(), flowsAnswer(FLOW_LIST.slice(0, 1), '"l2"')),
      [`DELETE ${FLS}/${STAFF_FLOW_ID}`]: gone,
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Delete staff' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByText('Delete staff?')).toBeVisible();
  await user.click(within(dialog).getByRole('button', { name: 'Delete staff' }));
  await waitFor(() => {
    expect(sent.some((s) => s.method === 'DELETE')).toBe(true);
  });
  expect(await screen.findByText('staff was deleted.')).toBeVisible();
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'Delete staff' })).toBeNull();
  });
});

it('words the refusal of the default flow in the dialog', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    flowRoutes(undefined, {
      [`DELETE ${FLS}/${STAFF_FLOW_ID}`]: problem(409, 'about:blank#default-flow', 'Conflict'),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Delete staff' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.click(within(dialog).getByRole('button', { name: 'Delete staff' }));
  expect(await within(dialog).findByText(/The default flow is not deleted/u)).toBeVisible();
});

it('says the flows could not be loaded, with a retry, and leaves the rest of the page', async () => {
  renderConsoleAt(AT, flowRoutes(undefined, { [`GET ${FLS}`]: problem(500) }));
  expect(await screen.findByText('The flows could not be loaded')).toBeVisible();
  expect(await screen.findByRole('region', { name: 'Steps' })).toBeVisible();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, flowRoutes()).element,
      () => table(),
    ),
  ).toEqual({ light: [], dark: [] });
});
