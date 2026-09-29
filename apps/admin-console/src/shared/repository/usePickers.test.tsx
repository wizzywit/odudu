import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it } from 'vitest';
import { createQueryClient } from '#/shared/repository/queryClient.ts';
import { useGroupPicker } from '#/shared/repository/useGroupPicker.ts';
import { useRolePicker } from '#/shared/repository/useRolePicker.ts';
import { TransportContext } from '#/shared/transport/useTransport.ts';
import { fakeTransport, json, problem, type Answer } from '#/testing/fakeTransport.ts';

const ROLES = 'GET /console/api/admin/tenants/acme/roles';
const GROUPS = 'GET /console/api/admin/tenants/acme/groups';
const CURSOR = 'b2Zmc2V0LTE.dGFnMQ';

function role(id: string) {
  return {
    id,
    name: id,
    description: null,
    client_id: null,
    client_key: null,
    default_for_new_subjects: false,
    created_at: '2026-09-28T13:41:05Z',
  };
}

function wrapperFor(routes: Record<string, Answer>) {
  const fake = fakeTransport(routes);
  const queryClient = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TransportContext value={fake.transport}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </TransportContext>
  );
  const asked = () => fake.sent.map((request) => `${request.path}?${request.search.toString()}`);
  return { wrapper, asked };
}

it('searches roles by name and loads the next page in place', async () => {
  const { wrapper, asked } = wrapperFor({
    [ROLES]: (request) =>
      json(
        request.search.get('cursor') === CURSOR
          ? { items: [role('r2')] }
          : { items: [role('r1')], next: CURSOR },
      )(request),
  });
  const { result } = renderHook(() => useRolePicker('acme', { client: 'tenant' }), { wrapper });
  await waitFor(() => {
    expect(result.current.options.map((r) => r.id)).toEqual(['r1']);
  });
  expect(result.current.more).toBe(true);
  act(() => {
    result.current.loadMore();
  });
  await waitFor(() => {
    expect(result.current.options.map((r) => r.id)).toEqual(['r1', 'r2']);
  });
  expect(result.current.more).toBe(false);
  act(() => {
    result.current.search('aud');
  });
  await waitFor(() => {
    expect(result.current.query).toBe('aud');
  });
  await waitFor(() => {
    expect(asked()).toEqual([
      '/console/api/admin/tenants/acme/roles?client=tenant',
      `/console/api/admin/tenants/acme/roles?client=tenant&cursor=${CURSOR}`,
      '/console/api/admin/tenants/acme/roles?name=aud&client=tenant',
    ]);
  });
});

it('reads groups, and says when the list is refused', async () => {
  const { wrapper } = wrapperFor({ [GROUPS]: problem(403, 'about:blank', 'Forbidden') });
  const { result } = renderHook(() => useGroupPicker('acme'), { wrapper });
  await waitFor(() => {
    expect(result.current.status).toBe('refused');
  });
});
