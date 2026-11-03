import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { useOwnRoles } from '#/features/own-roles/use-cases/useOwnRoles';
import { hookHarness } from '#/testing/hookHarness';
import { json, pending, type Answer } from '#/testing/fakeTransport';
import { whoami } from '#/testing/renderConsole';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };
const CAPABILITIES = `GET ${ACME_ADMIN}/subjects/s1/admin-capabilities`;
const GROUPS = `GET ${ACME_ADMIN}/subjects/s1/groups`;

const HELD = {
  items: [
    {
      id: 'r1',
      name: 'view-users',
      client_id: 'c1',
      client_key: 'odudu-admin',
      via: [{ kind: 'direct' }],
    },
  ],
  complete: true,
};

const GROUP = {
  id: 'g1',
  name: 'auditors',
  description: null,
  parent_id: null,
  default_for_new_subjects: false,
  path: '/auditors',
  created_at: '2026-09-28T08:41:53.858Z',
};

function own(tenant: string, routes: Record<string, Answer>) {
  const harness = hookHarness(routes);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  const view = renderHook(() => useOwnRoles(tenant), { wrapper });
  return { ...view, sent: harness.sent };
}

const readsOfSubject = (sent: readonly { path: string }[]) =>
  sent.filter((request) => request.path.includes('/subjects/')).length;

it('reads the principal’s roles and groups in its own tenant with view-users', async () => {
  const { result } = own('acme', {
    [`GET ${ACME_ADMIN}/whoami`]: whoami(['view-users']),
    [CAPABILITIES]: json(HELD),
    [GROUPS]: json({ items: [GROUP] }),
  });
  await waitFor(() => {
    expect(result.current.status).toBe('ready');
  });
  expect(result.current).toEqual({
    status: 'ready',
    roles: HELD.items,
    groups: ['/auditors'],
  });
});

it('is ready with nothing to lose in another tenant, and asks nothing of it', () => {
  const { result, sent } = own('globex', {});
  expect(result.current).toEqual({ status: 'ready', roles: [], groups: [] });
  expect(readsOfSubject(sent)).toBe(0);
});

it('is unknown without view-users, and reads neither list', async () => {
  const { result, sent } = own('acme', {
    [`GET ${ACME_ADMIN}/whoami`]: whoami(['manage-clients']),
  });
  await waitFor(() => {
    expect(result.current).toEqual({ status: 'unknown' });
  });
  expect(readsOfSubject(sent)).toBe(0);
});

it('is loading while whoami has not answered', () => {
  const { result } = own('acme', { [`GET ${ACME_ADMIN}/whoami`]: pending() });
  expect(result.current).toEqual({ status: 'loading' });
});
