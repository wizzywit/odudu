import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { useScopeRoles } from '#/features/scopes/use-cases/useScopeRoles';
import { json, type Answer } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { whoami } from '#/testing/renderConsole';
import { role } from '#/testing/roleAnswers';
import { BILLING_SCOPE, SC } from '#/testing/scopesFixtures';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };
const PUT = `PUT ${SC}/s-bill/roles`;

const KEYS = role('r-keys', 'manage-keys', 'odudu-admin');
const PLAIN = role('r-aud', 'auditor');

function roles(items: ReturnType<typeof role>[], extra: Record<string, Answer> = {}) {
  const harness = hookHarness({
    [`GET ${ACME_ADMIN}/whoami`]: whoami(['manage-tenant']),
    [`GET ${ACME_ADMIN}/roles`]: json({ items: [] }),
    [PUT]: json({ items: [] }, 200, { etag: '"r2"' }),
    ...extra,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  const view = renderHook(
    () =>
      useScopeRoles({
        tenant: 'acme',
        scope: BILLING_SCOPE,
        data: { items },
        etag: '"r1"',
        gone: false,
      }),
    { wrapper },
  );
  return { ...view, sent: harness.sent };
}

it('keeps a role the caller could not give when the choice is replaced, and saves it', async () => {
  const { result, sent } = roles([KEYS]);
  await waitFor(() => {
    expect(result.current.offered).toBe(true);
  });
  expect(result.current.kept).toEqual(['r-keys']);
  act(() => {
    result.current.choose([]);
  });
  expect(result.current.save.values.role_ids).toEqual(['r-keys']);
  act(() => {
    result.current.choose(['r-aud']);
  });
  expect(result.current.save.values.role_ids).toEqual(['r-aud', 'r-keys']);
  await waitFor(() => {
    expect(result.current.save.blocked).toBeUndefined();
  });
  act(() => {
    result.current.save.submit();
  });
  await waitFor(() => {
    expect(sent.some((request) => request.method === 'PUT')).toBe(true);
  });
  expect(sent.find((request) => request.method === 'PUT')?.body).toEqual({
    role_ids: ['r-aud', 'r-keys'],
  });
});

it('keeps nothing when every mapped role is one the caller could give', async () => {
  const { result } = roles([PLAIN]);
  await waitFor(() => {
    expect(result.current.offered).toBe(true);
  });
  expect(result.current.kept).toEqual([]);
  act(() => {
    result.current.choose([]);
  });
  expect(result.current.save.values.role_ids).toEqual([]);
});
