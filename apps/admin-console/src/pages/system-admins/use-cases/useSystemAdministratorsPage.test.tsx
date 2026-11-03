import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { useSystemAdministratorsPage } from '#/pages/system-admins/use-cases/useSystemAdministratorsPage';
import { useToasts } from '#/shared/repository/useToasts';
import { json, problem, whoamiReads, type Answer } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { adminClientRole } from '#/testing/roleAnswers';
import { whoami } from '#/testing/renderConsole';
import { administratorRoutes, ADMIN, EVERY_CAPABILITY } from '#/testing/tenantsFixtures';

vi.mock('#/shared/repository/useGo', () => ({ useGo: () => vi.fn() }));

const S = `${ADMIN}/system`;
const ROOT = { tenant: 'system', subjectId: 's0', username: 'root' };
const GRACE_WIRE = {
  id: 's-grace',
  type: 'user' as const,
  username: 'grace',
  email: null,
  enabled: true,
  created_at: '2026-09-28T08:41:53.858Z',
};
const GRACE = { ...GRACE_WIRE, createdAt: GRACE_WIRE.created_at };

function routes(extra: Record<string, Answer> = {}): Record<string, Answer> {
  const base = administratorRoutes('system', 'unused', 'unused');
  return {
    [`GET ${S}/whoami`]: whoami(EVERY_CAPABILITY),
    [`GET ${S}/clients`]: base[`GET ${S}/clients`] ?? json({ items: [] }),
    [`GET ${S}/roles`]: json({ items: [adminClientRole('r-admin', 'tenant-admin')] }),
    [`GET ${S}/subjects`]: (request) =>
      json({ items: request.search.get('capability') === null ? [GRACE_WIRE] : [] })(request),
    [`GET ${S}/subjects/s-grace/roles`]: json(
      { items: [{ id: 'reader', name: 'reader', client_id: null, client_key: null }] },
      200,
      { etag: '"s-grace-1"' },
    ),
    [`PUT ${S}/subjects/s-grace/roles`]: json({ items: [] }, 200, { etag: '"s-grace-2"' }),
    ...extra,
  };
}

function page(extra: Record<string, Answer> = {}) {
  const harness = hookHarness(routes(extra));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: ROOT, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  const view = renderHook(() => useSystemAdministratorsPage(), { wrapper });
  return { ...view, sent: harness.sent };
}

async function choosingGrace(extra: Record<string, Answer> = {}) {
  const view = page(extra);
  await waitFor(() => {
    expect(view.result.current.picker.options.map((option) => option.id)).toEqual(['s-grace']);
    expect(view.result.current.unavailableOf(GRACE)).toBeNull();
  });
  act(() => {
    view.result.current.pick(['s-grace']);
  });
  expect(view.result.current.chosen?.id).toBe('s-grace');
  return view;
}

afterEach(() => {
  useToasts.setState({ toasts: [], nextId: 1 });
});

it('gives the chosen subject its holdings, then clears the choice and says so', async () => {
  const { result, sent } = await choosingGrace();
  act(() => {
    result.current.grant();
  });
  await waitFor(() => {
    expect(result.current.chosen).toBeNull();
  });
  expect(sent.find((request) => request.method === 'PUT')).toMatchObject({
    path: `${S}/subjects/s-grace/roles`,
    body: { role_ids: ['reader', 'r-admin'] },
  });
  expect(result.current.grantMessage).toBeNull();
  expect(useToasts.getState().toasts.map((toast) => toast.message)).toEqual([
    'grace now holds Full (tenant-admin) in system.',
  ]);
});

it('reports a refusal against the capability its request needed, and keeps the choice', async () => {
  const { result, sent } = await choosingGrace({
    [`PUT ${S}/subjects/s-grace/roles`]: problem(403, 'about:blank', 'Forbidden'),
  });
  const before = whoamiReads(sent);
  act(() => {
    result.current.grant();
  });
  await waitFor(() => {
    expect(result.current.grantMessage).toBe(
      'grace was not given it: it needs the manage-users capability.',
    );
  });
  await waitFor(() => {
    expect(whoamiReads(sent)).toBeGreaterThan(before);
  });
  expect(result.current.chosen?.id).toBe('s-grace');
  expect(useToasts.getState().toasts).toEqual([]);
});

it('sets the holdings problem and sends nothing when none is chosen', async () => {
  const { result, sent } = await choosingGrace();
  act(() => {
    result.current.chooseHoldings([]);
  });
  act(() => {
    result.current.grant();
  });
  expect(result.current.holdingsError).toBe('Choose Full, or at least one capability.');
  expect(sent.some((request) => request.method === 'PUT')).toBe(false);
  act(() => {
    result.current.chooseHoldings(['tenant-admin']);
  });
  expect(result.current.holdingsError).toBeUndefined();
});
