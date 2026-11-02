import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { Write } from '#/shared/repository/useWrite';
import type { GatewayResult } from '#/shared/services/result';
import type { Answer } from '#/testing/fakeTransport';
import { hookHarness, rejectingTransport } from '#/testing/hookHarness';

interface Settled {
  noun: string;
  useWrite: (tenant: string) => Write<string, GatewayResult<unknown>>;
  id: string;
  // The request the write makes, and the refusal the server answers it with.
  request: string;
  refusal: Answer;
  listKey: readonly unknown[];
}

// A write that reads its list again whatever came of it: refused or lost.
export function settledWriteContract({ noun, useWrite, id, request, refusal, listKey }: Settled) {
  it(`reads the list again after a ${noun}, also when the server refused it`, async () => {
    const { wrapper, invalidated } = hookHarness({ [request]: refusal });
    const { result } = renderHook(() => useWrite('acme'), { wrapper });
    let answer: Awaited<ReturnType<typeof result.current.run>> | undefined;
    await act(async () => {
      answer = await result.current.run(id);
    });
    expect(answer?.ok).toBe(false);
    expect(invalidated).toHaveBeenCalledWith({ queryKey: listKey });
  });

  it(`answers a ${noun} whose send threw as a defect and still reads the list again`, async () => {
    const { wrapper, invalidated } = hookHarness({}, rejectingTransport());
    const { result } = renderHook(() => useWrite('acme'), { wrapper });
    await act(async () => {
      expect(await result.current.run(id)).toEqual({ ok: false, kind: 'defect' });
    });
    expect(invalidated).toHaveBeenCalledWith({ queryKey: listKey });
  });
}
