import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { A, C, clientRoutes } from '#/testing/clientsFixtures.ts';
import { json, problem } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';
import { subject } from '#/testing/subjectsFixtures.ts';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/clients/c-bill?tab=scopes';
const EVALUATE = `GET ${C}/c-bill/evaluate`;
const ADA = subject('u-ada', 'ada');

function routes(extra = {}, capabilities?: readonly string[]) {
  return clientRoutes(capabilities, {
    [`GET ${A}/scopes`]: json({ items: [] }),
    [`GET ${A}/subjects`]: json({ items: [ADA] }),
    ...extra,
  });
}

async function chooseAda(user: ReturnType<typeof userEvent.setup>) {
  const section = await screen.findByRole('region', { name: 'Evaluate' });
  await user.click(await within(section).findByRole('option', { name: /ada/u }));
  return section;
}

it('asks for the claims of the subject chosen, with the scope typed, and shows each artefact', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    routes({
      [EVALUATE]: json({
        scope: 'openid profile',
        id_token: { sub: 'u-ada', name: 'Ada' },
        access_token: { sub: 'u-ada' },
        userinfo: { sub: 'u-ada', name: 'Ada' },
      }),
    }),
  );
  const section = await chooseAda(user);
  await user.type(within(section).getByRole('textbox', { name: 'Scope' }), 'openid profile');
  await user.click(within(section).getByRole('button', { name: 'Evaluate claims' }));
  expect(await within(section).findByText(/^Claims for /u)).toHaveTextContent(
    'Claims for openid profile.',
  );
  expect(within(section).getByRole('region', { name: 'ID token claims' })).toHaveTextContent(
    '"name": "Ada"',
  );
  expect(within(section).getByRole('region', { name: 'Access token claims' })).toBeVisible();
  expect(within(section).getByRole('region', { name: 'UserInfo claims' })).toBeVisible();
  expect(sent.find((s) => s.path === `${C}/c-bill/evaluate`)?.search.get('subject')).toBe('u-ada');
  expect(sent.find((s) => s.path === `${C}/c-bill/evaluate`)?.search.get('scope')).toBe(
    'openid profile',
  );
});

it("asks for the client's default scopes when none is typed", async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    routes({
      [EVALUATE]: json({ scope: 'openid', id_token: null, access_token: {}, userinfo: {} }),
    }),
  );
  const section = await chooseAda(user);
  await user.click(within(section).getByRole('button', { name: 'Evaluate claims' }));
  await within(section).findByText(/^Claims for /u);
  expect(sent.find((s) => s.path === `${C}/c-bill/evaluate`)?.search.has('scope')).toBe(false);
});

it('says there is no ID token when the scope names no openid', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    routes({
      [EVALUATE]: json({ scope: 'email', id_token: null, access_token: {}, userinfo: {} }),
    }),
  );
  const section = await chooseAda(user);
  await user.click(within(section).getByRole('button', { name: 'Evaluate claims' }));
  expect(await within(section).findByText('No ID token: the scope names no openid.')).toBeVisible();
});

it('asks for the claims once, since each ask is audited, however often the window is focused again', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    routes({
      [EVALUATE]: json({ scope: 'openid', id_token: null, access_token: {}, userinfo: {} }),
    }),
  );
  const section = await chooseAda(user);
  await user.click(within(section).getByRole('button', { name: 'Evaluate claims' }));
  await within(section).findByText(/^Claims for /u);
  window.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('online'));
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(sent.filter((s) => s.path === `${C}/c-bill/evaluate`)).toHaveLength(1);
});

it('asks again when the person presses Evaluate again', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    routes({
      [EVALUATE]: json({ scope: 'openid', id_token: null, access_token: {}, userinfo: {} }),
    }),
  );
  const section = await chooseAda(user);
  await user.click(within(section).getByRole('button', { name: 'Evaluate claims' }));
  await within(section).findByText(/^Claims for /u);
  await user.click(within(section).getByRole('button', { name: 'Evaluate claims' }));
  await waitFor(() => {
    expect(sent.filter((s) => s.path === `${C}/c-bill/evaluate`)).toHaveLength(2);
  });
});

it('holds Evaluate back until a subject is chosen', async () => {
  renderConsoleAt(AT, routes());
  const section = await screen.findByRole('region', { name: 'Evaluate' });
  expect(within(section).getByRole('button', { name: 'Evaluate claims' })).toBeDisabled();
});

it('searches the subjects by username on the server', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, routes());
  const section = await screen.findByRole('region', { name: 'Evaluate' });
  await user.type(
    await within(section).findByRole('searchbox', { name: 'Search subjects by username' }),
    'ad',
  );
  await user.click(within(section).getByRole('button', { name: 'Search' }));
  await waitFor(() => {
    expect(sent.some((s) => s.path === `${A}/subjects` && s.search.get('username') === 'ad')).toBe(
      true,
    );
  });
});

it("says in the server's words why the claims could not be worked out", async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    routes({
      [EVALUATE]: problem(403, 'about:blank', 'Forbidden', {
        detail: 'evaluating needs view-users',
      }),
    }),
  );
  const section = await chooseAda(user);
  await user.click(within(section).getByRole('button', { name: 'Evaluate claims' }));
  expect(await within(section).findByRole('alert')).toHaveTextContent(
    'The evaluation was not carried out: evaluating needs view-users',
  );
});

it('needs view-users, and says so in place of the form', async () => {
  renderConsoleAt(AT, routes({}, ['manage-clients', 'manage-tenant']));
  const section = await screen.findByRole('region', { name: 'Evaluate' });
  expect(within(section).getByRole('note')).toHaveTextContent(
    'Evaluating a subject needs the view-users capability.',
  );
  expect(within(section).queryByRole('button', { name: 'Evaluate claims' })).toBeNull();
});

it('passes axe in both themes, with claims shown', async () => {
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(
          AT,
          routes({
            [EVALUATE]: json({
              scope: 'openid',
              id_token: { sub: 'u-ada' },
              access_token: { sub: 'u-ada' },
              userinfo: { sub: 'u-ada' },
            }),
          }),
        ).element,
      async () => {
        const user = userEvent.setup();
        const section = await chooseAda(user);
        await user.click(within(section).getByRole('button', { name: 'Evaluate claims' }));
        await within(section).findByText(/^Claims for /u);
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
