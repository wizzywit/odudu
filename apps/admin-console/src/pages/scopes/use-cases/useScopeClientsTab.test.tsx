import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { useScopeClientsTab } from '#/pages/scopes/use-cases/useScopeClientsTab';
import { recordKey } from '#/shared/repository/queryKeys';
import type { RecordEntry } from '#/shared/repository/useRecord';
import { useToasts } from '#/shared/repository/useToasts';
import { BILLING, C } from '#/testing/clientsFixtures';
import { json, type Answer } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { whoami } from '#/testing/renderConsole';
import { BILLING_CARRIES, BILLING_SCOPE, SC } from '#/testing/scopesFixtures';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };
const PUT = `PUT ${SC}/s-bill/clients/c-bill`;
const HELD_KEY = recordKey('acme', 'clients/c-bill');
const ASSIGNED = {
  client_id: 'c-bill',
  scopes: [{ id: 's-bill', name: 'billing', assignment: 'optional' }],
};

afterEach(() => {
  useToasts.setState({ toasts: [], nextId: 1 });
});

function tab(extra: Record<string, Answer> = {}) {
  const harness = hookHarness({
    [`GET ${ACME_ADMIN}/whoami`]: whoami(['manage-tenant', 'manage-clients']),
    [`GET ${SC}/s-bill/clients`]: json({ items: [BILLING_CARRIES] }),
    [`GET ${C}`]: json({ items: [BILLING] }),
    ...extra,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  const view = renderHook(() => useScopeClientsTab({ tenant: 'acme', scope: BILLING_SCOPE }), {
    wrapper,
  });
  harness.queryClient.setQueryData<RecordEntry<{ scopes: unknown[] }>>(HELD_KEY, {
    by: 'read',
    result: { ok: true, status: 200, data: { scopes: [] }, etag: '"old"', next: null },
  });
  return { ...view, ...harness };
}

function held(queryClient: ReturnType<typeof tab>['queryClient']) {
  return queryClient.getQueryData<RecordEntry<{ scopes: unknown[] }>>(HELD_KEY);
}

it('rebases the client record it holds on the ETag the assignment answered', async () => {
  const { result, queryClient } = tab({ [PUT]: json(ASSIGNED, 200, { etag: '"c-bill-2"' }) });
  await waitFor(() => {
    expect(result.current.offered).toBe(true);
  });
  await act(async () => {
    await result.current.change(BILLING_CARRIES, 'optional');
  });
  const entry = held(queryClient);
  expect(entry?.by).toBe('save');
  expect(entry?.result.etag).toBe('"c-bill-2"');
  expect(entry?.result.data.scopes).toEqual(ASSIGNED.scopes);
});

it('drops the record it holds when the answer carries no ETag', async () => {
  const { result, queryClient } = tab({ [PUT]: json(ASSIGNED) });
  await waitFor(() => {
    expect(result.current.offered).toBe(true);
  });
  await act(async () => {
    await result.current.change(BILLING_CARRIES, 'optional');
  });
  expect(held(queryClient)).toBeUndefined();
});
