import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it } from 'vitest';
import {
  useOverviewReads,
  type OverviewAsks,
} from '#/features/overview/repository/useOverviewReads.ts';
import { createQueryClient } from '#/shared/repository/queryClient.ts';
import { TransportContext } from '#/shared/transport/useTransport.ts';
import { fakeTransport, json, pending, problem, type Answer } from '#/testing/fakeTransport.ts';

const NOTHING: OverviewAsks = {
  discovery: false,
  subjects: false,
  clients: false,
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
  const client = createQueryClient();
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
      'GET /console/api/admin/tenants/acme/roles/count': json({ count: 4, capped: false }),
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
    '/console/api/admin/tenants/acme/roles/count',
    '/console/api/tenants/acme/discovery',
    '/console/api/tenants/acme/jwks',
  ]);
});

it('shows a read waiting, then refused or failed, and reads it again on retry', async () => {
  const { calls, hook } = mount(
    {
      'GET /console/api/admin/tenants/acme/audit': problem(403, 'about:blank', 'Forbidden'),
      'GET /console/api/admin/tenants/acme/smtp': problem(500, 'about:blank', 'Broken'),
      'GET /console/api/admin/tenants/acme/settings': pending(),
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
