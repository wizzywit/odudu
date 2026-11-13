import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { json, problem } from '#/testing/fakeTransport';
import { flowRecordBody, flowRoutes, FLS, STAFF_FLOW_ID } from '#/testing/flowFixtures';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/flow/new';

async function nameField() {
  return screen.findByRole('textbox', { name: /Name/u });
}

it('makes a flow with the default flow’s steps, and opens it', async () => {
  const user = userEvent.setup();
  const { sent, router } = renderConsoleAt(
    AT,
    flowRoutes(undefined, {
      [`POST ${FLS}`]: json(flowRecordBody(STAFF_FLOW_ID, 'partners'), 201),
      [`GET ${FLS}/${STAFF_FLOW_ID}`]: json(flowRecordBody(STAFF_FLOW_ID, 'partners'), 200, {
        etag: '"p1"',
      }),
    }),
  );
  await user.type(await nameField(), '  partners ');
  await user.click(await screen.findByRole('button', { name: 'Create flow' }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe(`/acme/flow/${STAFF_FLOW_ID}`);
  });
  expect(sent.find((s) => s.method === 'POST')?.body).toEqual({
    name: 'partners',
    steps: [
      { authenticator: 'passkey', requirement: 'alternative' },
      { authenticator: 'password', requirement: 'alternative' },
      { authenticator: 'otp', requirement: 'conditional' },
    ],
  });
});

it('asks for a name before sending anything', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, flowRoutes());
  await nameField();
  await user.click(await screen.findByRole('button', { name: 'Create flow' }));
  expect(await screen.findByText('Enter a name.')).toBeVisible();
  expect(sent.some((s) => s.method === 'POST')).toBe(false);
});

it('says under the name that another flow holds it', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    flowRoutes(undefined, {
      [`POST ${FLS}`]: problem(409, 'about:blank#flow-name-taken', 'Conflict', {
        detail: 'a flow named "staff" already exists',
      }),
    }),
  );
  await user.type(await nameField(), 'staff');
  await user.click(await screen.findByRole('button', { name: 'Create flow' }));
  expect(await screen.findByText('A flow named "staff" already exists.')).toBeVisible();
});

it('says under the name that the tenant holds as many flows as it may', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    flowRoutes(undefined, {
      [`POST ${FLS}`]: problem(409, 'about:blank#flow-limit', 'Conflict', {
        detail: 'a tenant holds at most 20 flows',
      }),
    }),
  );
  await user.type(await nameField(), 'one more');
  await user.click(await screen.findByRole('button', { name: 'Create flow' }));
  expect(await screen.findByText('A tenant holds at most 20 flows.')).toBeVisible();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, flowRoutes()).element,
      () => nameField(),
    ),
  ).toEqual({ light: [], dark: [] });
});
