import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useEndTenantSessions } from '#/features/tenant-sessions/repository/useTenantSessions';
import { json, pending, problem } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';

const path = 'DELETE /console/api/admin/tenants/acme/sessions';
const ANSWER = { ended: 2, remaining: 0, beyond_ceiling: 0 };
const ENDED = { ended: 2, remaining: 0, beyondCeiling: 0 };

it('ends every session and reads every list and count of the tenant again', async () => {
  const { wrapper, invalidated } = hookHarness({ [path]: json(ANSWER) });
  const { result } = renderHook(() => useEndTenantSessions('acme'), { wrapper });
  let answer: Awaited<ReturnType<typeof result.current.run>> | undefined;
  await act(async () => {
    answer = await result.current.run('all');
  });
  expect(answer).toMatchObject({ ok: true, data: ENDED });
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['list', 'acme'] });
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['count', 'acme'] });
});

it('reads them again when the server refused as well, since the answer says nothing of what held', async () => {
  const { wrapper, invalidated } = hookHarness({
    [path]: problem(403, 'about:blank', 'Forbidden'),
  });
  const { result } = renderHook(() => useEndTenantSessions('acme'), { wrapper });
  let answer: Awaited<ReturnType<typeof result.current.run>> | undefined;
  await act(async () => {
    answer = await result.current.run('all');
  });
  expect(answer?.ok).toBe(false);
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['list', 'acme'] });
});

it('is busy from the press until the server answers', async () => {
  const { wrapper } = hookHarness({ [path]: pending() });
  const { result } = renderHook(() => useEndTenantSessions('acme'), { wrapper });
  expect(result.current.busy).toBe(false);
  act(() => {
    result.current.run('all').catch(() => undefined);
  });
  await waitFor(() => {
    expect(result.current.busy).toBe(true);
  });
});
