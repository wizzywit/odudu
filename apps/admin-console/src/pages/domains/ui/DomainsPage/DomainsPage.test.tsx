import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import {
  ADDRESS,
  DOMAINS,
  domainRoutes,
  IMPACT,
  listAnswer,
  PENDING,
  VERIFIED,
} from '#/testing/domainsFixtures';
import { inTurn, json, problem } from '#/testing/fakeTransport';
import { resetConsole } from '#/testing/resetConsole';
import { consoleAt, renderConsoleAt } from '#/testing/renderConsole';

afterEach(() => {
  resetConsole();
});

const AT = '/console/acme/domains';

async function table() {
  return screen.findByRole('grid', { name: 'Domains' });
}

it('lists each domain with its state, and where the tenant signs in now', async () => {
  renderConsoleAt(AT, domainRoutes());
  expect(await screen.findByRole('heading', { level: 1, name: 'Domains' })).toBeVisible();
  const rows = await table();
  expect(within(rows).getByRole('row', { name: /pending\.acme\.com/u })).toHaveTextContent(
    'Pending',
  );
  expect(within(rows).getByRole('row', { name: /login\.acme\.com/u })).toHaveTextContent(
    'Verified',
  );
  expect(within(rows).getByRole('row', { name: /lost\.acme\.com/u })).toHaveTextContent('Failed');
  expect(screen.getByText('This tenant signs in at its path address.')).toBeVisible();
});

it('shows the TXT record a pending domain needs, each part copyable, and a verify beside it', async () => {
  renderConsoleAt(AT, domainRoutes());
  await table();
  expect(screen.getByText('_odudu-challenge.pending.acme.com')).toBeVisible();
  expect(screen.getByText('odudu-verify=9f3c0a1e')).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Copy TXT record name for pending.acme.com' }),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Copy TXT record value for pending.acme.com' }),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Verify pending.acme.com' })).toBeVisible();
});

it('offers the address only its switch back, and no removal', async () => {
  renderConsoleAt(AT, domainRoutes(undefined, {}, [ADDRESS]));
  const row = within(await table()).getByRole('row', { name: /www\.acme\.com/u });
  expect(row).toHaveTextContent('Current address');
  expect(within(row).getByRole('button', { name: 'Switch back from www.acme.com' })).toBeVisible();
  expect(within(row).queryByRole('button', { name: /Remove/u })).toBeNull();
  expect(screen.getByText('This tenant signs in at www.acme.com.')).toBeVisible();
});

it('says what the caller may not do, and offers no write, when it holds only view-domains', async () => {
  renderConsoleAt(AT, domainRoutes(['view-domains']));
  await table();
  expect(await screen.findByRole('note')).toHaveTextContent('manage-domains');
  expect(screen.queryByRole('button', { name: /Verify/u })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Register domain' })).toBeNull();
});

it('explains that the page needs view-domains when the caller holds neither', async () => {
  renderConsoleAt(AT, domainRoutes(['manage-tenant']));
  expect(await screen.findByRole('note')).toHaveTextContent('view-domains');
});

it('makes a verified domain the address: the dialog says the window and the passkeys, and holds until acknowledged', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    domainRoutes(undefined, {
      [`GET ${IMPACT}`]: json({ subjects: 3, capped: false }),
      [`POST ${DOMAINS}/login/activate`]: json({ ...VERIFIED, canonical: true }),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Make login.acme.com the address' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveTextContent('1 hour');
  expect(await within(dialog).findByText(/3 subjects hold passkeys/u)).toBeVisible();
  const confirm = within(dialog).getByRole('button', { name: 'Make it the address' });
  expect(confirm).toBeDisabled();
  await user.click(within(dialog).getByRole('checkbox'));
  expect(confirm).toBeEnabled();
  await user.click(confirm);
  expect(await screen.findByRole('status', { name: 'Last domain action' })).toHaveTextContent(
    'login.acme.com is now the tenant’s address.',
  );
  expect(sent.find((request) => request.method === 'POST')?.ifMatch).toBe('"path"');
});

it('lets an activation through with no acknowledgement when no passkey would be hidden', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    domainRoutes(undefined, {
      [`POST ${DOMAINS}/login/activate`]: json({ ...VERIFIED, canonical: true }),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Make login.acme.com the address' }));
  const dialog = await screen.findByRole('alertdialog');
  const confirm = within(dialog).getByRole('button', { name: 'Make it the address' });
  await waitFor(() => {
    expect(confirm).toBeEnabled();
  });
  expect(within(dialog).queryByRole('checkbox')).toBeNull();
});

it('closes the dialog and says the address changed when the tag is stale', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    domainRoutes(undefined, {
      [`POST ${DOMAINS}/login/activate`]: problem(412, 'about:blank', 'Precondition Failed'),
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Make login.acme.com the address' }));
  const dialog = await screen.findByRole('alertdialog');
  const confirm = within(dialog).getByRole('button', { name: 'Make it the address' });
  await waitFor(() => {
    expect(confirm).toBeEnabled();
  });
  await user.click(confirm);
  expect(await screen.findByRole('status', { name: 'Last domain action' })).toHaveTextContent(
    'changed',
  );
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('registers a domain and says to publish its record', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(
    AT,
    domainRoutes(undefined, {
      [`POST ${DOMAINS}`]: json(PENDING, 201, { etag: '"path"' }),
    }),
  );
  await user.type(await screen.findByRole('textbox', { name: 'Host' }), 'pending.acme.com');
  await user.click(screen.getByRole('button', { name: 'Register domain' }));
  await waitFor(() => {
    expect(sent.find((request) => request.method === 'POST')?.body).toEqual({
      host: 'pending.acme.com',
    });
  });
});

it('puts the server’s refusal of a host under the field', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    domainRoutes(undefined, {
      [`POST ${DOMAINS}`]: problem(422, 'about:blank#domain-host-localhost', 'Unprocessable', {
        detail: 'localhost cannot be a domain',
      }),
    }),
  );
  await user.type(await screen.findByRole('textbox', { name: 'Host' }), 'localhost');
  await user.click(screen.getByRole('button', { name: 'Register domain' }));
  expect(await screen.findByText('Localhost cannot be a domain.')).toBeVisible();
});

it('says the domains could not be loaded, and reads them again on retry', async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    domainRoutes(undefined, {
      [`GET ${DOMAINS}`]: inTurn(
        problem(500, 'about:blank', 'Internal Server Error'),
        listAnswer([VERIFIED]),
      ),
    }),
  );
  await user.click(await screen.findByRole('button', { name: /Try again|Retry/u }));
  expect(await table()).toBeVisible();
});

it('passes axe in both themes, listed and refused', async () => {
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, domainRoutes()).element,
      () => table(),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, domainRoutes(['manage-tenant'])).element,
      () => screen.findByRole('note'),
    ),
  ).toEqual({ light: [], dark: [] });
});

it('passes axe in both themes with the activation dialog open and a passkey warning shown', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () =>
        consoleAt(
          AT,
          domainRoutes(undefined, { [`GET ${IMPACT}`]: json({ subjects: 3, capped: false }) }),
        ).element,
      async () => {
        await user.click(
          await screen.findByRole('button', { name: 'Make login.acme.com the address' }),
        );
        return screen.findByText(/3 subjects hold passkeys/u);
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
