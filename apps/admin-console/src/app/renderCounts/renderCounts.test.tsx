import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { json, type Answer, type Sent } from '#/testing/fakeTransport.ts';
import { renderCount, resetRenderCount } from '#/testing/renderCounter.ts';
import { renderConsoleAt, resetConsole } from '#/testing/renderConsole.tsx';
import { ADMIN, administratorRoutes, systemRoutes, tenant } from '#/testing/tenantsFixtures.ts';
import { ADA, ADA_AT, ADA_ID, S, subject, subjectRoutes } from '#/testing/subjectsFixtures.ts';

afterEach(() => {
  resetConsole();
  sessionStorage.clear();
});

// Function-component renders over one journey, after the page is up. These
// are ceilings: a change that makes a keystroke or a click render more of the
// page than this fails here.
const CEILING = { typing: 5752, paging: 494, capability: 134 } as const;

function report(journey: string, ceiling: number): void {
  const count = renderCount();
  const top = count.byComponent
    .slice(0, 8)
    .map(([name, n]) => `${name} ${String(n)}`)
    .join(', ');
  console.info(
    `${journey}: ${String(count.commits)} commits, ${String(count.renders)} renders; ${top}`,
  );
  expect(count.renders).toBeLessThanOrEqual(ceiling);
}

it('renders little of the subject record for ten characters typed into the Account tab', async () => {
  const user = userEvent.setup();
  renderConsoleAt(ADA_AT, subjectRoutes());
  const email = await screen.findByRole('textbox', { name: 'Email' });
  await user.clear(email);
  resetRenderCount();
  await user.type(email, 'abcdefghij');
  expect(email).toHaveValue('abcdefghij');
  report('typing', CEILING.typing);
});

it('renders little of the list for a page of subjects', async () => {
  const user = userEvent.setup();
  const later = subject('01a0e72d-7fc7-7950-a1e7-1d079588f8c1', 'linus');
  const page: Answer = (request: Sent) =>
    request.search.get('cursor') === 'bmV4dA.dGFn'
      ? json({ items: [later] })(request)
      : json({ items: [ADA], next: 'bmV4dA.dGFn' })(request);
  renderConsoleAt(
    '/console/acme/subjects',
    subjectRoutes(undefined, {
      [`GET ${S}`]: page,
      [`GET ${S}/count`]: json({ count: 2, capped: false }),
    }),
  );
  await screen.findByRole('row', { name: /ada/u });
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });
  resetRenderCount();
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  expect(await screen.findByRole('row', { name: /linus/u })).toBeVisible();
  report('paging', CEILING.paging);
});

it('renders little of the page for a capability picked in the new-tenant flow', async () => {
  const user = userEvent.setup();
  const audit = {
    id: 'r-audit',
    name: 'view-audit',
    description: null,
    client_id: 'c-admin',
    client_key: 'odudu-admin',
    default_for_new_subjects: false,
    admin_reach: [],
    created_at: '2026-09-28T08:41:53.858Z',
  };
  renderConsoleAt(
    '/console/system/tenants/acme/new-administrator',
    systemRoutes({
      [`POST ${ADMIN}`]: json(tenant('acme'), 201),
      ...administratorRoutes('acme', ADA_ID, 'one-time-Qm9vYmFyYmF6'),
      [`GET ${ADMIN}/acme/roles`]: (request: Sent) =>
        json({ items: request.search.get('name') === 'view-audit' ? [audit] : [] })(request),
    }),
  );
  const holds = await screen.findByRole('group', { name: 'What they hold' });
  await user.click(within(holds).getByRole('checkbox', { name: 'Full (tenant-admin)' }));
  resetRenderCount();
  await user.click(within(holds).getByRole('checkbox', { name: 'view-audit' }));
  expect(within(holds).getByRole('checkbox', { name: 'view-audit' })).toBeChecked();
  report('capability', CEILING.capability);
});
