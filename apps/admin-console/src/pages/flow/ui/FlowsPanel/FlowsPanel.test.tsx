import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { inTurn, json, problem } from '#/testing/fakeTransport';
import {
  DEFAULT_FLOW_ID,
  flowListItem,
  flowRecordBody,
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
  expect(fallback).toHaveTextContent('None');
  expect(within(fallback).getByRole('link', { name: 'Edit default' })).toHaveAttribute(
    'href',
    `/console/acme/flow/${DEFAULT_FLOW_ID}`,
  );
  expect(within(fallback).queryByRole('button', { name: /Delete/u })).toBeNull();
  const staff = within(rows).getByRole('row', { name: /staff/u });
  expect(staff).toHaveTextContent('2 clients');
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
      [`GET ${FLS}/${STAFF_FLOW_ID}`]: json(FLOW_LIST[1], 200, { etag: '"st1"' }),
      [`DELETE ${FLS}/${STAFF_FLOW_ID}`]: gone,
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Delete staff' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByText('Delete staff?')).toBeVisible();
  await user.click(await within(dialog).findByRole('button', { name: 'Delete staff' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'DELETE')?.ifMatch).toBe('"st1"');
  });
  expect(await screen.findByText('staff was deleted.')).toBeVisible();
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'Delete staff' })).toBeNull();
  });
});

it('makes a flow the default after asking, on the tag the flow was read with', async () => {
  const user = userEvent.setup();
  const staffTag = '"st1"';
  const { sent } = renderConsoleAt(
    AT,
    flowRoutes(undefined, {
      [`GET ${FLS}`]: inTurn(
        flowsAnswer(),
        flowsAnswer(
          [
            flowListItem(DEFAULT_FLOW_ID, 'default', false),
            flowListItem(STAFF_FLOW_ID, 'staff', true),
          ],
          '"l2"',
        ),
      ),
      [`GET ${FLS}/${STAFF_FLOW_ID}`]: json(FLOW_LIST[1], 200, { etag: staffTag }),
      [`POST ${FLS}/${STAFF_FLOW_ID}/make-default`]: json(
        flowListItem(STAFF_FLOW_ID, 'staff', true),
        200,
        { etag: '"st2"' },
      ),
    }),
  );
  const grid = await table();
  expect(
    within(within(grid).getByRole('row', { name: /default/u })).queryByRole('button', {
      name: /Make .* the default/u,
    }),
  ).toBeNull();
  await user.click(await screen.findByRole('button', { name: 'Make staff the default' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByText('Make staff the default?')).toBeVisible();
  await user.click(await within(dialog).findByRole('button', { name: 'Make default' }));
  expect(await screen.findByText('staff is now the default flow.')).toBeVisible();
  expect(sent.find((s) => s.method === 'POST')?.ifMatch).toBe(staffTag);
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'Make staff the default' })).toBeNull();
  });
});

it('binds a delete to the version the dialog showed: a flow changed meanwhile asks again', async () => {
  const user = userEvent.setup();
  const edited = { ...flowRecordBody(STAFF_FLOW_ID, 'staff', false), steps: [] };
  const { sent } = renderConsoleAt(
    AT,
    flowRoutes(undefined, {
      [`GET ${FLS}/${STAFF_FLOW_ID}`]: inTurn(
        json(FLOW_LIST[1], 200, { etag: '"st1"' }),
        json(edited, 200, { etag: '"st2"' }),
      ),
      [`DELETE ${FLS}/${STAFF_FLOW_ID}`]: inTurn(
        problem(412, 'about:blank', 'Precondition Failed'),
        gone,
      ),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Delete staff' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.click(await within(dialog).findByRole('button', { name: 'Delete staff' }));
  expect(await within(dialog).findByText(/changed since/u)).toBeVisible();
  expect(await within(dialog).findByText(/No steps/u)).toBeVisible();
  await user.click(within(dialog).getByRole('button', { name: 'Delete staff' }));
  await waitFor(() => {
    expect(sent.filter((s) => s.method === 'DELETE').map((s) => s.ifMatch)).toEqual([
      '"st1"',
      '"st2"',
    ]);
  });
});

it('words the refusal of the default flow in the dialog', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    flowRoutes(undefined, {
      [`GET ${FLS}/${STAFF_FLOW_ID}`]: json(FLOW_LIST[1], 200, { etag: '"st1"' }),
      [`DELETE ${FLS}/${STAFF_FLOW_ID}`]: problem(409, 'about:blank#default-flow', 'Conflict'),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Delete staff' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.click(await within(dialog).findByRole('button', { name: 'Delete staff' }));
  expect(await within(dialog).findByText(/The default flow is not deleted/u)).toBeVisible();
});

it('words the refusal of a flow a client names in the dialog, with the count it showed', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    flowRoutes(undefined, {
      [`GET ${FLS}/${STAFF_FLOW_ID}`]: json(FLOW_LIST[1], 200, { etag: '"st1"' }),
      [`DELETE ${FLS}/${STAFF_FLOW_ID}`]: problem(409, 'about:blank#flow-in-use', 'Conflict'),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Delete staff' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByText(/once the 2 clients that use it use another/u)).toBeVisible();
  await user.click(await within(dialog).findByRole('button', { name: 'Delete staff' }));
  expect(await within(dialog).findByText(/2 clients use staff/u)).toBeVisible();
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
