import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { json } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { useGuardedWrite } from '#/shared/lib/repository/useGuardedWrite';

it('sends once however often it is pressed before the answer, then again after it', async () => {
  const { wrapper, sent } = hookHarness({ 'POST /console/api/x': json({}) });
  const settled = vi.fn();
  const { result } = renderHook(
    () =>
      useGuardedWrite(
        (gateway, input: string) =>
          gateway.request('POST', 'x', { body: { input }, schema: z.unknown() }),
        settled,
      ),
    { wrapper },
  );
  let second: Awaited<ReturnType<typeof result.current.run>> | undefined;
  await act(async () => {
    const first = result.current.run('a');
    second = await result.current.run('b');
    await first;
  });
  expect(second).toEqual({ ok: false, kind: 'defect' });
  expect(sent.filter((request) => request.method === 'POST')).toHaveLength(1);
  await waitFor(() => {
    expect(settled).toHaveBeenCalledTimes(1);
  });
  await act(async () => {
    await result.current.run('c');
  });
  expect(sent.filter((request) => request.method === 'POST')).toHaveLength(2);
});
