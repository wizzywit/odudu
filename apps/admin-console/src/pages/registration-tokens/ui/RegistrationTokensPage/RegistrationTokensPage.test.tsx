import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { inTurn, json, offline, problem } from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import {
  MINTED,
  MINTED_SECRET,
  RT,
  TOKEN_FEW,
  TOKEN_ONE,
  tokenRoutes,
} from '#/testing/tokensFixtures';
import { expectRefusedThenCancelled } from '#/testing/refusedThenCancelled';

afterEach(() => {
  resetConsole();
});

const AT = '/console/acme/registration-tokens';

it('lists the live tokens with their uses left, and says spent ones are gone', async () => {
  renderConsoleAt(AT, tokenRoutes());
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Registration tokens' }),
  ).toBeVisible();
  const table = await screen.findByRole('grid', { name: 'Registration tokens' });
  expect(within(table).getByRole('row', { name: /t-few/u })).toHaveTextContent('5');
  expect(screen.getByText(/disappears from this list/u)).toBeVisible();
  expect(screen.getByText(/Audit trail holds the history/u)).toBeVisible();
  expect(screen.getByRole('status', { name: 'Last revoke' })).not.toHaveFocus();
  expect(screen.getByRole('status', { name: 'Last mint' })).toBeEmptyDOMElement();
});

it('says no token is live when there is none', async () => {
  renderConsoleAt(AT, tokenRoutes(undefined, { [`GET ${RT}`]: json({ items: [] }) }));
  expect(await screen.findByText('No registration tokens yet')).toBeVisible();
});

it('pages through the list a page at a time', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    tokenRoutes(undefined, {
      [`GET ${RT}`]: (request) =>
        json(
          request.search.get('cursor') === null
            ? { items: [TOKEN_ONE], next: 'c2' }
            : { items: [TOKEN_FEW] },
        )(request),
    }),
  );
  await screen.findByRole('grid', { name: 'Registration tokens' });
  await user.click(await screen.findByRole('button', { name: 'Load more registration tokens' }));
  await waitFor(() => {
    expect(sent.some((s) => s.path === RT && s.search.get('cursor') === 'c2')).toBe(true);
  });
  expect(await screen.findByRole('row', { name: /t-few/u })).toBeVisible();
});

it('mints with the numbers given, shows the token once, and never after', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    tokenRoutes(undefined, {
      [`POST ${RT}`]: json(MINTED, 201),
      [`GET ${RT}`]: inTurn(
        json({ items: [TOKEN_ONE] }),
        json({ items: [TOKEN_ONE, { ...TOKEN_FEW, id: 't-new', remaining_uses: 3 }] }),
      ),
    }),
  );
  const uses = await screen.findByRole('textbox', { name: 'Uses' });
  await user.clear(uses);
  await user.type(uses, '3');
  await user.click(screen.getByRole('button', { name: 'Mint token' }));
  const dialog = await screen.findByRole('dialog', { name: 'New registration token' });
  expect(dialog).toHaveTextContent(MINTED_SECRET);
  expect(sent.find((s) => s.method === 'POST')?.body).toEqual({ uses: 3, ttl_seconds: 3600 });
  const close = within(dialog).getByRole('button', { name: 'Close' });
  expect(close).toBeDisabled();
  await user.click(within(dialog).getByText(/^I have stored the registration token/u));
  await user.click(close);
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(document.body.textContent).not.toContain(MINTED_SECRET);
  expect(await screen.findByRole('row', { name: /t-new/u })).toBeVisible();
  const toasts = screen.getByRole('region', { name: 'Notifications' });
  expect(toasts).toHaveTextContent('Registration token minted: 3 uses');
  expect(within(toasts).getByText('Done')).toBeVisible();
  expect(within(toasts).queryByRole('alert')).toBeNull();
  expect(toasts).not.toHaveTextContent(MINTED_SECRET);
});

it('refuses a number outside its range without sending, naming the range', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, tokenRoutes());
  const uses = await screen.findByRole('textbox', { name: 'Uses' });
  await user.clear(uses);
  await user.type(uses, '0');
  await user.click(screen.getByRole('button', { name: 'Mint token' }));
  expect(await screen.findByText(/1 to 2,147,483,647/u)).toBeVisible();
  expect(sent.some((s) => s.method === 'POST')).toBe(false);
});

it('places the server’s refusal of a value under its field', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    tokenRoutes(undefined, {
      [`POST ${RT}`]: problem(400, 'about:blank', 'Bad Request', {
        errors: [{ path: 'ttl_seconds', message: 'must be at most 31536000' }],
      }),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Mint token' }));
  expect(await screen.findByText('must be at most 31536000')).toBeVisible();
});

it('says beside the button that a lost answer was not sent again', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, tokenRoutes(undefined, { [`POST ${RT}`]: offline() }));
  await user.click(await screen.findByRole('button', { name: 'Mint token' }));
  expect(await screen.findByRole('status', { name: 'Last mint' })).toHaveTextContent(
    /not been sent again/u,
  );
});

it('asks before revoking, says what is lost, and reads the list again', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    tokenRoutes(undefined, {
      [`DELETE ${RT}/t-few`]: () => new Response(null, { status: 204 }),
      [`GET ${RT}`]: inTurn(json({ items: [TOKEN_ONE, TOKEN_FEW] }), json({ items: [TOKEN_ONE] })),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Revoke t-few' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Revoke this token?' });
  expect(dialog).toHaveTextContent('5 uses');
  expect(dialog).toHaveTextContent('already registered');
  await user.click(within(dialog).getByRole('button', { name: 'Revoke token' }));
  expect(await screen.findByText('The token was revoked.')).toBeVisible();
  await waitFor(() => {
    expect(screen.queryByRole('row', { name: /t-few/u })).toBeNull();
  });
  await waitFor(() => {
    expect(screen.getByRole('status', { name: 'Last revoke' })).toHaveFocus();
  });
  expect(sent.filter((s) => s.method === 'DELETE')).toHaveLength(1);
});

it('treats a 404 as already gone and reads the list again', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    tokenRoutes(undefined, { [`DELETE ${RT}/t-few`]: problem(404, 'about:blank', 'Not Found') }),
  );
  await user.click(await screen.findByRole('button', { name: 'Revoke t-few' }));
  await user.click(await screen.findByRole('button', { name: 'Revoke token' }));
  expect(await screen.findByText(/already gone/u)).toBeVisible();
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('keeps the dialog and says why when a revoke is refused', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    tokenRoutes(undefined, { [`DELETE ${RT}/t-few`]: problem(403, 'about:blank', 'Forbidden') }),
  );
  await user.click(await screen.findByRole('button', { name: 'Revoke t-few' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.click(within(dialog).getByRole('button', { name: 'Revoke token' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('manage-clients');
});

it('reads whoami again after a refusal, and asks afresh once cancelled', async () => {
  await expectRefusedThenCancelled(
    AT,
    tokenRoutes(undefined, { [`DELETE ${RT}/t-few`]: problem(403, 'about:blank', 'Forbidden') }),
    { open: 'Revoke t-few', confirm: 'Revoke token' },
  );
});

it('names manage-clients for a caller without it', async () => {
  renderConsoleAt(AT, tokenRoutes(['manage-tenant']));
  expect(await screen.findByRole('note')).toHaveTextContent('manage-clients');
  expect(screen.queryByRole('button', { name: 'Mint token' })).toBeNull();
});

it('passes axe in both themes, listed, refused and with the token shown', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, tokenRoutes()).element,
      () => screen.findByRole('grid', { name: 'Registration tokens' }),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, tokenRoutes(['manage-tenant'])).element,
      () => screen.findByRole('note'),
    ),
  ).toEqual({ light: [], dark: [] });
});

it('passes axe in both themes with the revoke dialog open', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, tokenRoutes()).element,
      async () => {
        await user.click(await screen.findByRole('button', { name: 'Revoke t-few' }));
        return screen.findByRole('alertdialog');
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
