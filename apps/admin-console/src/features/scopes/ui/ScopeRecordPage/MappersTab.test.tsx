import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { inTurn, json, pending, problem } from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';
import { SC, scopeRoutes } from '#/testing/scopesFixtures';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

const AT = '/console/acme/scopes/s-bill?tab=mappers';

async function open() {
  return screen.findByRole('region', { name: 'Claim mappers' });
}

it('offers every registered mapper, and shows the declared ones ticked and greyed while none is bound', async () => {
  renderConsoleAt(AT, scopeRoutes());
  const section = await open();
  const email = within(section).getByRole('checkbox', { name: 'email' });
  expect(email).toBeChecked();
  expect(email).toBeDisabled();
  expect(within(section).getByText('Used because nothing is bound')).toBeVisible();
  const groups = within(section).getByRole('checkbox', { name: 'groups' });
  expect(groups).not.toBeChecked();
  expect(groups).toBeEnabled();
  expect(within(section).getByText('Nothing bound. These mappers run by default.')).toBeVisible();
});

it('binds only the mapper ticked beside the defaults, which then stop applying', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, scopeRoutes());
  const section = await open();
  await user.click(within(section).getByRole('checkbox', { name: 'groups' }));
  expect(within(section).getByRole('checkbox', { name: 'groups' })).toBeChecked();
  expect(within(section).getByRole('checkbox', { name: 'email' })).not.toBeChecked();
  expect(within(section).queryByText('Used because nothing is bound')).toBeNull();
  await user.click(within(section).getByRole('button', { name: 'Save Claim mappers' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')?.body).toEqual({ mapper_names: ['groups'] });
  });
});

it('goes back to the defaults when the last bound mapper is unticked', async () => {
  const user = userEvent.setup();
  renderConsoleAt(AT, scopeRoutes());
  const section = await open();
  await user.click(within(section).getByRole('checkbox', { name: 'groups' }));
  await user.click(within(section).getByRole('checkbox', { name: 'groups' }));
  expect(within(section).getByRole('checkbox', { name: 'email' })).toBeChecked();
  expect(within(section).getByText('Used because nothing is bound')).toBeVisible();
});

it('shows no default when nothing declares the scope', async () => {
  renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`GET ${SC}/s-bill/mappers`]: json(
        { available: ['email', 'groups'], bound: [], declared: [] },
        200,
        { etag: '"s-bill-m1"' },
      ),
    }),
  );
  const section = await open();
  expect(within(section).getByRole('checkbox', { name: 'email' })).not.toBeChecked();
  expect(within(section).queryByText('Used because nothing is bound')).toBeNull();
});

it('passes axe in both themes with the defaults shown', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, scopeRoutes()).element,
      async () => {
        await open();
      },
    ),
  ).toEqual({ light: [], dark: [] });
});

it('says it is loading the mappers until the read answers', async () => {
  renderConsoleAt(AT, scopeRoutes(undefined, { [`GET ${SC}/s-bill/mappers`]: pending() }));
  expect(await screen.findByText('Loading the mappers')).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Claim mappers' })).toBeNull();
});

it('says the claim mappers could not be loaded when the read carries no ETag to save against', async () => {
  renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`GET ${SC}/s-bill/mappers`]: json({ available: ['email'], bound: [], declared: [] }),
    }),
  );
  expect(await screen.findByText('The claim mappers could not be loaded')).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Claim mappers' })).toBeNull();
});

it('shows the bound mappers checked', async () => {
  renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`GET ${SC}/s-bill/mappers`]: json(
        { available: ['email', 'groups'], bound: ['groups'], declared: ['email'] },
        200,
        {
          etag: '"s-bill-m1"',
        },
      ),
    }),
  );
  const section = await open();
  expect(within(section).getByRole('checkbox', { name: 'groups' })).toBeChecked();
  expect(within(section).getByText('Bound: groups.')).toBeVisible();
});

it('saves the chosen set on the ETag it was read with, in the registry order', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`PUT ${SC}/s-bill/mappers`]: json(
        { available: ['email', 'groups'], bound: ['email', 'groups'], declared: ['email'] },
        200,
        {
          etag: '"s-bill-m2"',
        },
      ),
    }),
  );
  const section = await open();
  await user.click(within(section).getByRole('checkbox', { name: 'groups' }));
  await user.click(within(section).getByRole('checkbox', { name: 'email' }));
  await user.click(within(section).getByRole('button', { name: 'Save Claim mappers' }));
  await waitFor(() => {
    expect(sent.find((s) => s.method === 'PUT')).toMatchObject({
      ifMatch: '"s-bill-m1"',
      body: { mapper_names: ['email', 'groups'] },
    });
  });
});

it('saves a second time on the ETag the first save answered', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`GET ${SC}/s-bill/mappers`]: inTurn(
        json({ available: ['email', 'groups'], bound: [], declared: ['email'] }, 200, {
          etag: '"s-bill-m1"',
        }),
        json({ available: ['email', 'groups'], bound: ['groups'], declared: ['email'] }, 200, {
          etag: '"s-bill-m2"',
        }),
      ),
      [`PUT ${SC}/s-bill/mappers`]: inTurn(
        json({ available: ['email', 'groups'], bound: ['groups'], declared: ['email'] }, 200, {
          etag: '"s-bill-m2"',
        }),
        json(
          { available: ['email', 'groups'], bound: ['email', 'groups'], declared: ['email'] },
          200,
          {
            etag: '"s-bill-m3"',
          },
        ),
      ),
    }),
  );
  const section = await open();
  await user.click(within(section).getByRole('checkbox', { name: 'groups' }));
  await user.click(within(section).getByRole('button', { name: 'Save Claim mappers' }));
  await within(section).findByText('Bound: groups.');
  await user.click(within(section).getByRole('checkbox', { name: 'email' }));
  await user.click(within(section).getByRole('button', { name: 'Save Claim mappers' }));
  await waitFor(() => {
    expect(sent.filter((s) => s.method === 'PUT').map((s) => s.ifMatch)).toEqual([
      '"s-bill-m1"',
      '"s-bill-m2"',
    ]);
  });
});

it('names the mappers the registry knows when one was refused as unknown', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`PUT ${SC}/s-bill/mappers`]: problem(400, 'about:blank', 'Bad Request', {
        detail: 'unknown mapper name(s): groups; known: email',
        errors: [{ path: 'mapper_names', message: 'names no registered mapper groups' }],
      }),
    }),
  );
  const section = await open();
  await user.click(within(section).getByRole('checkbox', { name: 'groups' }));
  await user.click(within(section).getByRole('button', { name: 'Save Claim mappers' }));
  expect(
    await within(section).findByText('Not saved: no mapper named groups. The mappers are email.'),
  ).toBeVisible();
});

it('shows a 412 as a conflict', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`PUT ${SC}/s-bill/mappers`]: problem(412, 'about:blank', 'Precondition Failed'),
    }),
  );
  const section = await open();
  await user.click(within(section).getByRole('checkbox', { name: 'groups' }));
  await user.click(within(section).getByRole('button', { name: 'Save Claim mappers' }));
  expect(await within(section).findByText(/changed elsewhere/u)).toBeVisible();
});

it('says what each side of a mapper conflict holds, as a sentence or as none', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    scopeRoutes(undefined, {
      [`PUT ${SC}/s-bill/mappers`]: problem(412, 'about:blank', 'Precondition Failed'),
      [`GET ${SC}/s-bill/mappers`]: inTurn(
        json({ available: ['email', 'groups'], bound: [], declared: ['email'] }, 200, {
          etag: '"s-bill-m1"',
        }),
        json({ available: ['email', 'groups'], bound: ['email', 'groups'], declared: [] }, 200, {
          etag: '"s-bill-m2"',
        }),
      ),
    }),
  );
  const section = await open();
  await user.click(within(section).getByRole('checkbox', { name: 'groups' }));
  await user.click(within(section).getByRole('button', { name: 'Save Claim mappers' }));
  expect(
    await within(section).findByRole('button', { name: 'Keep mine in Claim mappers' }),
  ).toBeVisible();
  expect(within(section).getByText('email and groups')).toBeVisible();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, scopeRoutes()).element,
      () => open(),
    ),
  ).toEqual({ light: [], dark: [] });
});
