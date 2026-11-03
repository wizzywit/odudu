import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { useNewClient } from '#/pages/clients/use-cases/useNewClient';
import { useToasts } from '#/shared/lib/repository/useToasts';
import { BILLING, C } from '#/testing/clientsFixtures';
import { json, problem, type Answer } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { whoami } from '#/testing/renderConsole';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const go = vi.fn<(href: string, options?: { replace?: boolean }) => void>();

vi.mock('#/shared/lib/repository/useGo', () => ({ useGo: () => go }));

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };
const SECRET = 'cs_only-shown-once';

afterEach(() => {
  useToasts.setState({ toasts: [], nextId: 1 });
  go.mockClear();
});

function newClient(extra: Record<string, Answer>) {
  const harness = hookHarness({
    [`GET ${ACME_ADMIN}/whoami`]: whoami(['manage-clients']),
    [`GET ${C}`]: json({ items: [] }),
    ...extra,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  const view = renderHook(() => useNewClient('acme'), { wrapper });
  return { ...view, ...harness };
}

it('says CLIENT_ID_TAKEN under the client ID when the server refuses it without a reason', async () => {
  const { result } = newClient({ [`POST ${C}`]: problem(409, 'about:blank', 'Conflict') });
  act(() => {
    result.current.editClientId('billing');
  });
  act(() => {
    result.current.submit();
  });
  await waitFor(() => {
    expect(result.current.errors.client_id).toBe('That client ID is taken.');
  });
  expect(go).not.toHaveBeenCalled();
});

it('shows the secret of a confidential client once, and moves on only when it is closed', async () => {
  const { result } = newClient({
    [`POST ${C}`]: json({ ...BILLING, client_secret: SECRET }, 201),
  });
  act(() => {
    result.current.editClientId('billing');
  });
  act(() => {
    result.current.submit();
  });
  await waitFor(() => {
    expect(result.current.secret).toBe(SECRET);
  });
  expect(result.current.secretTitle).toBe('Client secret for Billing');
  expect(go).not.toHaveBeenCalled();
  act(() => {
    result.current.closeSecret();
  });
  expect(result.current.secret).toBeNull();
  expect(JSON.stringify(result.current)).not.toContain(SECRET);
  expect(go).toHaveBeenCalledWith('/console/acme/clients/c-bill', { replace: true });
});
