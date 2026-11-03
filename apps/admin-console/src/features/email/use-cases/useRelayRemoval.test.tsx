import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { useRelayRemoval } from '#/features/email/use-cases/useRelayRemoval';
import { problem } from '#/testing/fakeTransport';
import { hookHarness, rejectingTransport } from '#/testing/hookHarness';
import { resetConsole } from '#/testing/resetConsole';
import { emailRoutes, SM } from '#/testing/settingsFixtures';

afterEach(() => {
  resetConsole();
});

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };

function removal(
  extra: Parameters<typeof emailRoutes>[1] = {},
  transport?: Parameters<typeof hookHarness>[1],
) {
  const harness = hookHarness(emailRoutes(undefined, extra), transport);
  const reread = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  return { ...harness, reread, ...renderHook(() => useRelayRemoval('acme', reread), { wrapper }) };
}

const NO_CONTENT = () => new Response(null, { status: 204 });

it('asks before removing, and sends nothing until it is confirmed', () => {
  const { result, sent } = removal({ [`DELETE ${SM}`]: NO_CONTENT });
  act(() => {
    result.current.ask();
  });
  expect(result.current.confirming).toBe(true);
  act(() => {
    result.current.cancel();
  });
  expect(result.current.confirming).toBe(false);
  expect(sent.some((call) => call.method === 'DELETE')).toBe(false);
});

it('removes on confirm, says so, and has the page read again', async () => {
  const { result, sent, reread } = removal({ [`DELETE ${SM}`]: NO_CONTENT });
  act(() => {
    result.current.ask();
  });
  act(() => {
    result.current.confirm();
  });
  await waitFor(() => {
    expect(result.current.message).toBe('The tenant’s own relay was removed.');
  });
  expect(sent.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  expect(result.current.confirming).toBe(false);
  expect(reread).toHaveBeenCalledTimes(1);
});

it('says the tenant already had none when the server has nothing to remove, and reads again', async () => {
  const { result, reread } = removal({
    [`DELETE ${SM}`]: problem(404, 'about:blank', 'Not Found'),
  });
  act(() => {
    result.current.confirm();
  });
  await waitFor(() => {
    expect(result.current.message).toBe('The tenant already had none. The page is read again.');
  });
  expect(reread).toHaveBeenCalledTimes(1);
});

it('names manage-tenant when the removal is refused, and does not read again', async () => {
  const { result, reread } = removal({
    [`DELETE ${SM}`]: problem(403, 'about:blank', 'Forbidden'),
  });
  act(() => {
    result.current.confirm();
  });
  await waitFor(() => {
    expect(result.current.message).toContain('manage-tenant');
  });
  expect(reread).not.toHaveBeenCalled();
});

it('says the console could not remove it when the send threw', async () => {
  const { result } = removal({}, rejectingTransport());
  act(() => {
    result.current.confirm();
  });
  await waitFor(() => {
    expect(result.current.message).not.toBeNull();
  });
  expect(result.current.confirming).toBe(false);
});
