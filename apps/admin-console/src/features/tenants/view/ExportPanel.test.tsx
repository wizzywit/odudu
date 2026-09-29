import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json, problem, type Answer } from '#/testing/fakeTransport.ts';
import { consoleAt, renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';
import { ADMIN, systemRoutes, tenant } from '#/testing/tenantsFixtures.ts';

const saved: string[] = [];

beforeEach(() => {
  saved.length = 0;
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push(this.download);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetConsole();
  sessionStorage.clear();
});

const DOCUMENT = '{"version":1,"omitted":["clients[0].secret","smtp.password"]}';
const AT = '/console/system/tenants/acme?tab=export';

function routes(exported: Answer) {
  return systemRoutes({
    [`GET ${ADMIN}/acme`]: json(tenant('acme'), 200, { etag: '"t1"' }),
    [`GET ${ADMIN}/acme/export`]: exported,
  });
}

const DOCUMENT_ANSWER: Answer = () =>
  new Response(DOCUMENT, { headers: { 'content-type': 'application/vnd.odudu.tenant+json' } });

it('saves the export as a file named for the tenant and the day, and lists what it left out', async () => {
  const user = userEvent.setup();
  const { sent } = renderConsoleAt(AT, routes(DOCUMENT_ANSWER));
  await user.click(await screen.findByRole('switch', { name: 'Include subjects' }));
  await user.click(screen.getByRole('button', { name: 'Export to a file' }));
  const list = await screen.findByRole('list', { name: 'Left out of the file' });
  expect(
    within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual(['clients[0].secret', 'smtp.password']);
  const today = new Date().toISOString().slice(0, 10);
  expect(saved).toEqual([`acme-${today}.odudu-tenant.json`]);
  const bytes = new TextEncoder().encode(DOCUMENT).length;
  expect(
    screen.getByText(`Saved acme-${today}.odudu-tenant.json, ${String(bytes)} bytes.`),
  ).toBeVisible();
  expect(sent.find((s) => s.path.endsWith('/export'))?.search.get('include')).toBe('subjects');
});

it("says why an export was refused, in the server's words", async () => {
  const user = userEvent.setup();
  renderConsoleAt(
    AT,
    routes(
      problem(413, 'about:blank#export-too-large', 'Content Too Large', {
        detail: 'acme has more than 10000 subjects',
      }),
    ),
  );
  await user.click(await screen.findByRole('button', { name: 'Export to a file' }));
  expect(await screen.findByText('acme has more than 10000 subjects')).toBeVisible();
  expect(saved).toEqual([]);
});

it('passes axe in both themes, before and after an export', async () => {
  const user = userEvent.setup();
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, routes(DOCUMENT_ANSWER)).element,
      () => screen.findByRole('button', { name: 'Export to a file' }),
    ),
  ).toEqual({ light: [], dark: [] });
  expect(
    await axeInBothThemes(
      () => consoleAt(AT, routes(DOCUMENT_ANSWER)).element,
      async () => {
        await user.click(await screen.findByRole('button', { name: 'Export to a file' }));
        await waitFor(() => {
          expect(screen.getByRole('list', { name: 'Left out of the file' })).toBeVisible();
        });
      },
    ),
  ).toEqual({ light: [], dark: [] });
});
