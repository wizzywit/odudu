import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { useNewGroup } from '#/pages/groups/use-cases/useNewGroup';
import { useToasts } from '#/shared/repository/useToasts';
import { json, problem, type Answer } from '#/testing/fakeTransport';
import { G } from '#/testing/groupsFixtures';
import { hookHarness } from '#/testing/hookHarness';
import { whoami } from '#/testing/renderConsole';
import { ACME_ADMIN } from '#/testing/tenantPaths';

vi.mock('#/shared/repository/useGo', () => ({ useGo: () => vi.fn() }));
vi.mock('#/shared/repository/useUrlSearch', () => ({
  useUrlSearch: () => ({ params: new URLSearchParams(), go: vi.fn(), drop: vi.fn() }),
}));

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };

afterEach(() => {
  useToasts.setState({ toasts: [], nextId: 1 });
});

function newGroup(extra: Record<string, Answer>) {
  const harness = hookHarness({
    [`GET ${ACME_ADMIN}/whoami`]: whoami(['manage-tenant']),
    [`GET ${G}`]: json({ items: [] }),
    ...extra,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  const view = renderHook(() => useNewGroup('acme'), { wrapper });
  return { ...view, sent: harness.sent };
}

it('says NAME_TAKEN under the name when the server refuses it without a reason', async () => {
  const { result } = newGroup({ [`POST ${G}`]: problem(409, 'about:blank', 'Conflict') });
  await waitFor(() => {
    expect(result.current.held).toBeNull();
  });
  act(() => {
    result.current.editName('eng');
  });
  act(() => {
    result.current.submit();
  });
  await waitFor(() => {
    expect(result.current.errors.name).toBe('That name is taken there.');
  });
});

it('keeps the server’s own reason for a taken name when it gives one', async () => {
  const { result } = newGroup({
    [`POST ${G}`]: problem(409, 'about:blank', 'Conflict', {
      detail: 'a group named "eng" already exists there',
    }),
  });
  await waitFor(() => {
    expect(result.current.held).toBeNull();
  });
  act(() => {
    result.current.editName('eng');
  });
  act(() => {
    result.current.submit();
  });
  await waitFor(() => {
    expect(result.current.errors.name).toContain('already exists there');
  });
});
