import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useLockoutsClear } from '#/pages/settings/repository/useLockoutsClear';
import { json, pending, problem } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';

const path = 'DELETE /console/api/admin/tenants/acme/lockouts';
const ANSWER = { cleared: 2, beyond_ceiling: 0, remaining: 0 };

async function press(result: { current: ReturnType<typeof useLockoutsClear> }) {
  let answer: Awaited<ReturnType<typeof result.current.run>> | undefined;
  await act(async () => {
    answer = await result.current.run();
  });
  return answer;
}

it('clears the lockouts and reads every subject lockout of the tenant again, and the audit list', async () => {
  const { wrapper, invalidated, sent } = hookHarness({ [path]: json(ANSWER) });
  const { result } = renderHook(() => useLockoutsClear('acme'), { wrapper });
  expect(await press(result)).toMatchObject({ ok: true, data: ANSWER });
  expect(sent.map((s) => s.method)).toEqual(['DELETE']);
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['lockout', 'acme'] });
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['list', 'acme', 'audit'] });
});

it('reads them again when the server refused as well, since the answer says nothing of what held', async () => {
  const { wrapper, invalidated } = hookHarness({
    [path]: problem(403, 'about:blank', 'Forbidden'),
  });
  const { result } = renderHook(() => useLockoutsClear('acme'), { wrapper });
  expect((await press(result))?.ok).toBe(false);
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['lockout', 'acme'] });
});

it('is busy from the press until the server answers', async () => {
  const { wrapper } = hookHarness({ [path]: pending() });
  const { result } = renderHook(() => useLockoutsClear('acme'), { wrapper });
  expect(result.current.busy).toBe(false);
  act(() => {
    result.current.run().catch(() => undefined);
  });
  await waitFor(() => {
    expect(result.current.busy).toBe(true);
  });
});
