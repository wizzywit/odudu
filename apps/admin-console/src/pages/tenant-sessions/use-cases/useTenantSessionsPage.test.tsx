import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { SignedInContext } from '#/entities/session';
import type * as repository from '#/pages/tenant-sessions/repository/useTenantSessions';
import { useTenantSessionsPage } from '#/pages/tenant-sessions/use-cases/useTenantSessionsPage';
import type { TenantSession } from '#/pages/tenant-sessions/types/tenantSession';
import { hookHarness } from '#/testing/hookHarness';

vi.mock('#/shared/lib/repository/useGo', () => ({ useGo: () => vi.fn() }));

// The list reads the router's location; only the naming is under test here.
vi.mock('#/pages/tenant-sessions/repository/useTenantSessions', async (importOriginal) => ({
  ...(await importOriginal<typeof repository>()),
  useTenantSessionList: () => ({ status: 'loading', rows: [] }),
}));

const SESSION: TenantSession = {
  id: 'sess-1',
  subjectId: 's-ada',
  username: 'ada',
  createdAt: '2026-09-28T08:41:53.858Z',
  lastActiveAt: '2026-09-28T09:41:53.858Z',
  remembered: false,
  clientIds: [],
  device: null,
};

function page() {
  const harness = hookHarness({});
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext
      value={{ principal: { tenant: 'acme', subjectId: 's0', username: 'root' }, ended: null }}
    >
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  return renderHook(() => useTenantSessionsPage('acme'), { wrapper });
}

it('names a session by its subject username', () => {
  expect(page().result.current.subjectOf(SESSION)).toEqual({ label: 'ada', id: 's-ada' });
});

it('falls back to the subject id for a session whose subject has no username', () => {
  const { result } = page();
  expect(result.current.subjectOf({ ...SESSION, username: null })).toEqual({
    label: 's-ada',
    id: 's-ada',
  });
});
