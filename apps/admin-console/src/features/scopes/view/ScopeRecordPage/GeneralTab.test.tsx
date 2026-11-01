import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { inTurn, json, pending, problem, whoamiReads } from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { BILLING_SCOPE, impact, profileRoutes, SC, scopeRoutes } from '#/testing/scopesFixtures';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/scopes/s-bill';

it('shows the name and creation as fixed, and saves a description on the ETag', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`PATCH ${SC}/s-bill`]: json({ ...BILLING_SCOPE, description: 'Bills' }, 200, {
        etag: '"s-bill-2"',
      }),
    }),
  );
  expect(await screen.findByText(/A scope's name is the token a client asks for/u)).toBeVisible();
  const section = screen.getByRole('region', { name: 'Description' });
  const field = within(section).getByRole('textbox', { name: 'Description' });
  await user.clear(field);
  await user.type(field, 'Bills');
  await user.click(within(section).getByRole('button', { name: 'Save Description' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')).toMatchObject({
      ifMatch: '"s-bill-1"',
      body: { description: 'Bills' },
    });
  });
});

it('translates the description into the languages the tenant offers, and sends the map whole', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`GET ${SC}/s-bill`]: json(
        { ...BILLING_SCOPE, description_i18n: { de: 'Rechnungen' } },
        200,
        {
          etag: '"s-bill-1"',
        },
      ),
      [`PATCH ${SC}/s-bill`]: json(BILLING_SCOPE, 200, { etag: '"s-bill-2"' }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Description' });
  const group = within(section).getByRole('group', { name: 'Description by language' });
  await user.click(await within(group).findByRole('tab', { name: 'French (fr)' }));
  expect(
    within(group)
      .getAllByRole('tab')
      .map((tab) => tab.textContent),
  ).toEqual(['English (en)', 'French (fr)', 'German (de)']);
  await user.type(
    within(group).getByRole('textbox', { name: 'Translation into French (fr)' }),
    'Factures',
  );
  await user.click(within(section).getByRole('button', { name: 'Save Description' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({
      description_i18n: { de: 'Rechnungen', fr: 'Factures' },
    });
  });
});

it('translates the consent text on its own, in the consent section', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`PATCH ${SC}/s-bill`]: json(BILLING_SCOPE, 200, { etag: '"s-bill-2"' }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Consent' });
  const group = within(section).getByRole('group', { name: 'Consent text by language' });
  await user.click(await within(group).findByRole('tab', { name: 'German (de)' }));
  await user.type(
    within(group).getByRole('textbox', { name: 'Translation into German (de)' }),
    'Rechnungen lesen',
  );
  await user.click(within(section).getByRole('button', { name: 'Save Consent' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({
      consent_text_i18n: { de: 'Rechnungen lesen' },
    });
  });
});

it('saves a second time on the ETag the first save answered', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`GET ${SC}/s-bill`]: inTurn(
        json(BILLING_SCOPE, 200, { etag: '"s-bill-1"' }),
        json({ ...BILLING_SCOPE, description: 'One' }, 200, { etag: '"s-bill-2"' }),
      ),
      [`PATCH ${SC}/s-bill`]: inTurn(
        json({ ...BILLING_SCOPE, description: 'One' }, 200, { etag: '"s-bill-2"' }),
        json({ ...BILLING_SCOPE, description: 'Two' }, 200, { etag: '"s-bill-3"' }),
      ),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Description' });
  const field = within(section).getByRole('textbox', { name: 'Description' });
  await user.clear(field);
  await user.type(field, 'One');
  await user.click(within(section).getByRole('button', { name: 'Save Description' }));
  await waitFor(() => {
    expect(within(section).queryByRole('button', { name: 'Save Description' })).toBeNull();
  });
  await user.clear(field);
  await user.type(field, 'Two');
  await user.click(within(section).getByRole('button', { name: 'Save Description' }));
  await waitFor(() => {
    expect(sent.filter((s) => s.method === 'PATCH').map((s) => s.ifMatch)).toEqual([
      '"s-bill-1"',
      '"s-bill-2"',
    ]);
  });
});

it('sends an emptied description as null', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`PATCH ${SC}/s-bill`]: json({ ...BILLING_SCOPE, description: null }, 200, {
        etag: '"s-bill-2"',
      }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Description' });
  await user.clear(within(section).getByRole('textbox', { name: 'Description' }));
  await user.click(within(section).getByRole('button', { name: 'Save Description' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({ description: null });
  });
});

it('saves the two token flags together, changing only what was changed', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`PATCH ${SC}/s-bill`]: json({ ...BILLING_SCOPE, include_in_id_token: true }, 200, {
        etag: '"s-bill-2"',
      }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Tokens' });
  await user.click(within(section).getByRole('switch', { name: 'In the ID token' }));
  await user.click(within(section).getByRole('button', { name: 'Save Tokens' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({ include_in_id_token: true });
  });
});

it('shows a 412 as a conflict, and keeps the edit', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`PATCH ${SC}/s-bill`]: problem(412, 'about:blank', 'Precondition Failed'),
      [`GET ${SC}/s-bill`]: inTurn(
        json(BILLING_SCOPE, 200, { etag: '"s-bill-1"' }),
        json({ ...BILLING_SCOPE, description: 'Theirs' }, 200, { etag: '"s-bill-2"' }),
      ),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Description' });
  const field = within(section).getByRole('textbox', { name: 'Description' });
  await user.clear(field);
  await user.type(field, 'Mine');
  await user.click(within(section).getByRole('button', { name: 'Save Description' }));
  expect(
    await within(section).findByRole('button', { name: 'Keep mine in Description' }),
  ).toBeVisible();
  expect(within(section).getByText('Theirs')).toBeVisible();
});

it('holds Save while the display order is not a whole number, and sends it as one', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`PATCH ${SC}/s-bill`]: json({ ...BILLING_SCOPE, display_order: 3 }, 200, {
        etag: '"s-bill-2"',
      }),
    }),
  );
  const section = await screen.findByRole('region', { name: 'Consent' });
  const order = within(section).getByRole('textbox', { name: 'Display order' });
  await user.clear(order);
  await user.type(order, 'x');
  expect(
    within(section).getAllByText('Enter a whole number, zero or more.').length,
  ).toBeGreaterThan(0);
  expect(within(section).getByRole('button', { name: 'Save Consent' })).toBeDisabled();
  await user.clear(order);
  await user.type(order, '3');
  await user.type(within(section).getByRole('textbox', { name: 'Consent text' }), 'Read bills');
  await user.click(within(section).getByRole('button', { name: 'Save Consent' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({
      consent_text: 'Read bills',
      display_order: 3,
    });
  });
});

it('chooses how a client made from now on is assigned the scope, or not at all', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`PATCH ${SC}/s-bill`]: json(
        { ...BILLING_SCOPE, default_client_assignment: 'optional' },
        200,
        { etag: '"s-bill-2"' },
      ),
    }),
  );
  const section = await screen.findByRole('region', { name: 'New clients' });
  await user.click(within(section).getByRole('button', { name: /For a client made from now on/u }));
  await user.click(await screen.findByRole('option', { name: 'Assigned as optional' }));
  await user.click(within(section).getByRole('button', { name: 'Save New clients' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PATCH')?.body).toEqual({
      default_client_assignment: 'optional',
    });
  });
});

it('deletes a scope behind its typed name, and goes back to the list', async () => {
  const user = userEvent.setup();
  const { router } = renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`DELETE ${SC}/s-bill`]: () => new Response(null, { status: 204 }),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Delete billing' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Delete billing?' });
  expect(dialog).toHaveTextContent('takes it off every client assigned billing');
  await within(dialog).findByText(/1 client carries billing/u);
  const confirm = within(dialog).getByRole('button', { name: 'Delete billing' });
  expect(confirm).toBeDisabled();
  await user.type(within(dialog).getByRole('textbox'), 'billing');
  await user.click(confirm);
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/scopes');
  });
});

async function openDeletion() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Delete billing' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Delete billing?' });
  return { user, dialog };
}

it('warns, before the name is typed, how many clients and roles go with the scope', async () => {
  renderConsoleAt(AT, scopeRoutes());
  const { dialog } = await openDeletion();
  expect(
    await within(dialog).findByText(
      /1 client carries billing and will stop receiving its claims\. 1 role is mapped to it and will be unmapped\./u,
    ),
  ).toBeVisible();
  expect(within(dialog).getByRole('button', { name: 'Delete billing' })).toBeDisabled();
});

it('says nothing goes with a scope no client carries and no role maps', async () => {
  renderConsoleAt(AT, scopeRoutes(undefined, { [`GET ${SC}/s-bill/impact`]: json(impact(0, 0)) }));
  const { dialog } = await openDeletion();
  expect(await within(dialog).findByText(/No client carries billing/u)).toBeVisible();
  expect(dialog).toHaveTextContent('No role is mapped to it.');
});

it('reads the counts in one request, and says "or more" when they stopped at their ceiling', async () => {
  const { sent } = renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`GET ${SC}/s-bill/impact`]: json(impact(10_000, 2, { clientsCapped: true })),
    }),
  );
  const { dialog } = await openDeletion();
  expect(await within(dialog).findByText(/10,000 or more clients carry billing/u)).toBeVisible();
  expect(sent.filter((s) => s.method === 'GET' && s.path.endsWith('/s-bill/impact'))).toHaveLength(
    1,
  );
  expect(sent.some((s) => s.method === 'GET' && s.path.endsWith('/s-bill/clients'))).toBe(false);
});

it('never says none when the counts cannot be read', async () => {
  renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`GET ${SC}/s-bill/impact`]: problem(403, 'about:blank', 'Forbidden', {
        detail: 'requires manage-tenant',
      }),
    }),
  );
  const { dialog } = await openDeletion();
  expect(await within(dialog).findByText(/How many clients carry billing/u)).toBeVisible();
  expect(dialog).not.toHaveTextContent('No client carries');
  expect(within(dialog).getByRole('button', { name: 'Delete billing' })).toBeDisabled();
});

it('names the mappers behind its claims', async () => {
  renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`GET ${SC}/s-bill/mappers`]: json(
        { available: ['email', 'groups'], bound: ['groups'], declared: ['email'] },
        200,
        { etag: '"s-bill-m1"' },
      ),
    }),
  );
  const { dialog } = await openDeletion();
  expect(await within(dialog).findByText(/Its claims come from the groups mapper/u)).toBeVisible();
});

it('still deletes only once the name is typed, after the warning', async () => {
  const { router } = renderConsoleAt(
    AT,
    scopeRoutes(undefined, { [`DELETE ${SC}/s-bill`]: () => new Response(null, { status: 204 }) }),
  );
  const { user, dialog } = await openDeletion();
  await within(dialog).findByText(/1 client carries billing/u);
  await user.type(within(dialog).getByRole('textbox'), 'billing');
  await user.click(within(dialog).getByRole('button', { name: 'Delete billing' }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/scopes');
  });
});

it('says in the dialog why a delete the ceiling refuses was refused, reads whoami again, and stays', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`DELETE ${SC}/s-bill`]: problem(403, 'about:blank', 'Forbidden', {
        detail: 'this removes capabilities the caller does not hold: manage-keys',
      }),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Delete billing' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Delete billing?' });
  await within(dialog).findByText(/1 client carries billing/u);
  await user.type(within(dialog).getByRole('textbox'), 'billing');
  await user.click(within(dialog).getByRole('button', { name: 'Delete billing' }));
  expect(await within(dialog).findByText(/Refused: it would take manage-keys/u)).toBeVisible();
  expect(whoamiReads(sent)).toBeGreaterThan(1);
});

it('shows the openid delete refusal as fixed text, with no delete to press', async () => {
  const { sent } = renderConsoleAt('/console/acme/scopes/s-openid', scopeRoutes());
  expect(await screen.findByText(/openid cannot be deleted/u)).toBeVisible();
  expect(screen.queryByRole('button', { name: /^Delete/u })).toBeNull();
  expect(sent.some((s) => s.method === 'DELETE')).toBe(false);
});

it('passes axe in both themes, with the delete dialog open', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, scopeRoutes()).element,
      async () => {
        await user.click(await screen.findByRole('button', { name: 'Delete billing' }));
        await screen.findByRole('alertdialog', { name: 'Delete billing?' });
      },
    ),
  ).toEqual({ light: [], dark: [] });
});

it('shows the flag "In the ID token" kept in a draft beside the record\'s own, as on and off', async () => {
  sessionStorage.setItem(
    'odudu.console.drafts',
    JSON.stringify({
      owner: 'acme/s1',
      drafts: {
        'acme/scopes/s-bill': { tokens: { etag: '"old"', values: { include_in_id_token: true } } },
      },
    }),
  );
  renderConsoleAt(AT, scopeRoutes());
  const section = await screen.findByRole('region', { name: 'Tokens' });
  const row = await within(section).findByRole('row', { name: /In the ID token/u });
  expect(
    within(row)
      .getAllByRole('cell')
      .map((cell) => cell.textContent),
  ).toEqual(['off', 'on']);
});

const PROFILE_AT = '/console/acme/scopes/s-prof';

async function openProfileDeletion() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Delete profile' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Delete profile?' });
  return { user, dialog };
}

it('says a built-in scope is one, what goes with it and how to get it back', async () => {
  renderConsoleAt(PROFILE_AT, scopeRoutes(undefined, profileRoutes()));
  const { dialog } = await openProfileDeletion();
  expect(
    await within(dialog).findByText(
      /3 clients carry profile and will stop receiving its claims\. 2 roles are mapped to it and will be unmapped\./u,
    ),
  ).toBeVisible();
  expect(dialog).toHaveTextContent(
    'profile is a built-in scope, which every tenant has. Restore built-in scopes on the scopes list creates it again, without the clients and roles it had.',
  );
});

it('deletes a built-in scope only once its name is typed, and sends the name as the confirmation', async () => {
  const { sent, router } = renderConsoleAt(
    PROFILE_AT,
    scopeRoutes(undefined, {
      ...profileRoutes(),
      [`DELETE ${SC}/s-prof`]: () => new Response(null, { status: 204 }),
    }),
  );
  const { user, dialog } = await openProfileDeletion();
  await within(dialog).findByText(/built-in scope/u);
  const confirm = within(dialog).getByRole('button', { name: 'Delete profile' });
  expect(confirm).toBeDisabled();
  await user.type(within(dialog).getByRole('textbox'), 'profil');
  expect(confirm).toBeDisabled();
  await user.type(within(dialog).getByRole('textbox'), 'e');
  await user.click(confirm);
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/acme/scopes');
  });
  expect(sent.find((s) => s.method === 'DELETE')?.search.get('confirm')).toBe('profile');
});

it("says the server's reason in the dialog when it still wants a confirmation, and stays", async () => {
  renderConsoleAt(
    PROFILE_AT,
    scopeRoutes(undefined, {
      ...profileRoutes(),
      [`DELETE ${SC}/s-prof`]: problem(
        422,
        'about:blank#builtin-scope-confirmation',
        'Precondition Required',
        {
          detail: 'profile is a built-in scope. Repeat the request with confirm=profile.',
        },
      ),
    }),
  );
  const { user, dialog } = await openProfileDeletion();
  await user.type(within(dialog).getByRole('textbox'), 'profile');
  await user.click(within(dialog).getByRole('button', { name: 'Delete profile' }));
  expect(
    await within(dialog).findByText(/profile was not deleted: profile is a built-in scope/u),
  ).toBeVisible();
});

it('passes axe in both themes, with the built-in delete dialog open', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt(PROFILE_AT, scopeRoutes(undefined, profileRoutes())).element,
      async () => {
        await user.click(await screen.findByRole('button', { name: 'Delete profile' }));
        const dialog = await screen.findByRole('alertdialog', { name: 'Delete profile?' });
        await within(dialog).findByText(/built-in scope/u);
      },
    ),
  ).toEqual({ light: [], dark: [] });
});

it('reads the impact of a scope again each time the dialog is opened', async () => {
  const { sent } = renderConsoleAt(AT, scopeRoutes());
  const user = userEvent.setup();
  const reads = () => sent.filter((s) => s.method === 'GET' && s.path.endsWith('/s-bill/impact'));
  await user.click(await screen.findByRole('button', { name: 'Delete billing' }));
  await screen.findByText(/1 client carries billing/u);
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(reads()).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'Delete billing' }));
  await waitFor(() => {
    expect(reads()).toHaveLength(2);
  });
});

it('holds the delete, name typed or not, while the counts are being read', async () => {
  const { sent } = renderConsoleAt(
    AT,
    scopeRoutes(undefined, { [`GET ${SC}/s-bill/impact`]: pending() }),
  );
  const { user, dialog } = await openDeletion();
  expect(await within(dialog).findByText(/Checking what this affects…/u)).toBeVisible();
  await user.type(within(dialog).getByRole('textbox'), 'billing');
  expect(within(dialog).getByRole('button', { name: 'Delete billing' })).toBeDisabled();
  await user.keyboard('{Enter}');
  expect(sent.some((s) => s.method === 'DELETE')).toBe(false);
});

it('holds the delete when the counts cannot be read, and frees it once they are read again', async () => {
  renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`GET ${SC}/s-bill/impact`]: inTurn(
        problem(500, 'about:blank', 'Internal Server Error'),
        json(impact(1, 1)),
      ),
    }),
  );
  const { user, dialog } = await openDeletion();
  await within(dialog).findByText(/What this affects could not be read/u);
  await user.type(within(dialog).getByRole('textbox'), 'billing');
  expect(within(dialog).getByRole('button', { name: 'Delete billing' })).toBeDisabled();
  await user.click(within(dialog).getByRole('button', { name: 'Read again' }));
  await within(dialog).findByText(/1 client carries billing/u);
  expect(within(dialog).getByRole('button', { name: 'Delete billing' })).toBeEnabled();
});
