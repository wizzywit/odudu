import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it } from 'vitest';
import { useOverviewReads } from '#/pages/overview/repository/useOverviewReads';
import type { OverviewAsks } from '#/pages/overview/types/overviewReads';
import { createReadCache } from '#/shared/lib/repository/readCache';
import { TransportContext } from '#/shared/api/transport/useTransport';
import { fakeTransport, json, pending, problem, type Answer } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const NOTHING: OverviewAsks = {
  discovery: false,
  subjects: false,
  clients: false,
  operatorClients: false,
  groups: false,
  roles: false,
  scopes: false,
  settings: false,
  smtp: false,
  keys: false,
  audit: false,
};

function mount(routes: Record<string, Answer>, asks: OverviewAsks) {
  const fake = fakeTransport(routes);
  const client = createReadCache();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TransportContext value={fake.transport}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </TransportContext>
  );
  const hook = renderHook(() => useOverviewReads('acme', asks), { wrapper });
  return { ...fake, hook };
}

it('asks for nothing it was not told to', () => {
  const { calls, hook } = mount({}, NOTHING);
  expect(calls).toEqual([]);
  expect(hook.result.current.discovery).toEqual({ status: 'off' });
  expect(hook.result.current.counts.subjects).toEqual({ status: 'off' });
});

it('reads discovery and the JWKS together, and each count it is asked for', async () => {
  const { calls, hook } = mount(
    {
      'GET /console/api/tenants/acme/discovery': json({ issuer: 'https://id.example/t/acme' }),
      'GET /console/api/tenants/acme/jwks': json({ keys: [] }),
      [`GET ${ACME_ADMIN}/roles/count`]: json({ count: 4, capped: false }),
    },
    { ...NOTHING, discovery: true, roles: true },
  );
  await waitFor(() => {
    expect(hook.result.current.counts.roles.status).toBe('ready');
  });
  expect(hook.result.current.discovery).toMatchObject({
    status: 'ready',
    data: { issuer: 'https://id.example/t/acme' },
  });
  await waitFor(() => {
    expect(hook.result.current.jwks).toMatchObject({ status: 'ready', data: { keys: [] } });
  });
  expect(hook.result.current.counts.roles).toMatchObject({ data: { count: 4 } });
  expect(calls.map((call) => call.path).sort()).toEqual([
    `${ACME_ADMIN}/roles/count`,
    '/console/api/tenants/acme/discovery',
    '/console/api/tenants/acme/jwks',
  ]);
});

it('reads the clients max_clients counts apart from every client', async () => {
  const { hook } = mount(
    {
      [`GET ${ACME_ADMIN}/clients/count`]: (request) =>
        json(
          request.search.get('counts_toward_max_clients') === 'true'
            ? { count: 2, capped: false }
            : { count: 900, capped: false },
        )(request),
    },
    { ...NOTHING, clients: true, operatorClients: true },
  );
  await waitFor(() => {
    expect(hook.result.current.operatorClients.status).toBe('ready');
    expect(hook.result.current.counts.clients.status).toBe('ready');
  });
  expect(hook.result.current.operatorClients).toMatchObject({ data: { count: 2 } });
  expect(hook.result.current.counts.clients).toMatchObject({ data: { count: 900 } });
});

it('shows a read waiting, then refused or failed, and reads it again on retry', async () => {
  const { calls, hook } = mount(
    {
      [`GET ${ACME_ADMIN}/audit`]: problem(403, 'about:blank', 'Forbidden'),
      [`GET ${ACME_ADMIN}/smtp`]: problem(500, 'about:blank', 'Broken'),
      [`GET ${ACME_ADMIN}/settings`]: pending(),
    },
    { ...NOTHING, audit: true, smtp: true, settings: true },
  );
  expect(hook.result.current.settings).toEqual({ status: 'loading' });
  await waitFor(() => {
    expect(hook.result.current.audit).toMatchObject({ status: 'failed', refused: true });
  });
  await waitFor(() => {
    expect(hook.result.current.smtp).toMatchObject({ status: 'failed', refused: false });
  });
  const before = calls.length;
  const smtp = hook.result.current.smtp;
  if (smtp.status === 'failed') smtp.retry();
  await waitFor(() => {
    expect(calls.length).toBe(before + 1);
  });
});
