import { TENANT_IMPORT_BODY_LIMIT } from '@odudu/contracts/admin';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json, offline, problem, type Answer } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';
import { systemRoutes, tenant } from '#/testing/tenantsFixtures.ts';

const AT = '/console/system/import-tenant';
const IMPORT = 'POST /console/api/admin/tenant-imports';
const SECRET = 'imported-secret-c2VjcmV0';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error('no file input');
  return input;
}

function document_(text = '{"version":1}'): File {
  return new File([text], 'acme-2026-09-29.odudu-tenant.json', {
    type: 'application/vnd.odudu.tenant+json',
  });
}

async function fill(user: ReturnType<typeof userEvent.setup>, file: File = document_()) {
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'acme');
  await user.upload(fileInput(), file);
}

const REFUSED = problem(400, 'about:blank', 'Bad Request', {
  detail: 'the import was refused for 2 problem(s), listed under errors',
  errors: [
    { path: 'document.clients[0].redirect_uris', message: 'must be absolute https URIs' },
    { path: 'document.roles[3].name', message: 'is used twice' },
  ],
});

function routes(answer: Answer) {
  return systemRoutes({ [IMPORT]: answer });
}

it('lists every problem the import found, each at its path, and creates nothing', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, routes(REFUSED));
  await fill(user);
  expect(screen.getByText(/acme-2026-09-29\.odudu-tenant\.json, 13 bytes/u)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Import' }));
  const problems = await screen.findByRole('region', { name: '2 problems in the document' });
  expect(
    within(problems)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual([
    'document.clients[0].redirect_uris must be absolute https URIs',
    'document.roles[3].name is used twice',
  ]);
  expect(
    screen.getByText('the import was refused for 2 problem(s), listed under errors'),
  ).toHaveAttribute('role', 'status');
  expect(sent.find((s) => s.method === 'POST')?.body).toEqual({
    name: 'acme',
    document: { version: 1 },
  });
});

it('shows each client secret once, one at a time, then offers the first administrator', async () => {
  const user = userEvent.setup();
  const { router } = renderConsoleAt(
    AT,
    routes(
      json(
        {
          tenant: tenant('acme'),
          client_secrets: [
            { client_id: 'web', secret: `${SECRET}-1` },
            { client_id: 'api', secret: `${SECRET}-2` },
          ],
        },
        201,
      ),
    ),
  );
  await fill(user);
  await user.click(screen.getByRole('button', { name: 'Import' }));
  for (const [index, client] of ['web', 'api'].entries()) {
    const dialog = await screen.findByRole('dialog', {
      name: `Client secret for ${client}, ${String(index + 1)} of 2`,
    });
    expect(within(dialog).getByText(`${SECRET}-${String(index + 1)}`)).toBeVisible();
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
  }
  expect(screen.queryByText(new RegExp(SECRET, 'u'))).toBeNull();
  await user.click(await screen.findByRole('button', { name: 'Create the first administrator' }));
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/system/new-tenant');
  });
  expect(
    await screen.findByRole('heading', { level: 1, name: 'First administrator of acme' }),
  ).toBeVisible();
  expect(screen.getByText(/An import creates no administrator/u)).toBeVisible();
});

it('refuses a file too large, or not JSON, before sending anything', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, routes(REFUSED));
  const big = document_();
  Object.defineProperty(big, 'size', { value: TENANT_IMPORT_BODY_LIMIT + 1 });
  await fill(user, big);
  expect(screen.getByText(/larger than 16\.0 MiB/u)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Import' }));
  await user.upload(fileInput(), document_('{'));
  await user.click(screen.getByRole('button', { name: 'Import' }));
  expect(await screen.findByText(/is not JSON/u)).toBeVisible();
  expect(sent.filter((s) => s.method === 'POST')).toHaveLength(0);
});

it("says a body too large was refused before the server, as a proxy's limit is", async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    routes(() => new Response('<html>413 Request Entity Too Large</html>', { status: 413 })),
  );
  await fill(user);
  await user.click(screen.getByRole('button', { name: 'Import' }));
  expect(
    await screen.findByText(
      'The server, or a proxy in front of it, refused a body this large; see the deployment note on body limits.',
    ),
  ).toBeVisible();
});

it('never sends an import twice whose answer was lost', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, {
    ...routes(offline()),
    'GET /console/api/admin/tenants': json({ items: [] }),
  });
  await fill(user);
  await user.click(screen.getByRole('button', { name: 'Import' }));
  expect(await screen.findByText(/Could not confirm the import/u)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Check whether acme exists' }));
  expect(await screen.findByText('acme was not imported. Import it again.')).toBeVisible();
  expect(sent.filter((s) => s.method === 'POST')).toHaveLength(1);
});

it('passes axe in both themes, empty and with its problems listed', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, routes(REFUSED)).element,
      () => screen.findByRole('textbox', { name: 'Name' }),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, routes(REFUSED)).element,
      async () => {
        await fill(user);
        await user.click(screen.getByRole('button', { name: 'Import' }));
        await screen.findByRole('region', { name: '2 problems in the document' });
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
