import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { createReadCache } from '#/shared/lib/repository/readCache';
import { useGatewayWrite, useWrite } from '#/shared/lib/repository/useWrite';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';
import { TransportContext } from '#/shared/api/transport/useTransport';
import { fakeTransport } from '#/testing/fakeTransport';

const { transport } = fakeTransport({});
const queryClient = createReadCache();

function wrapper({ children }: { children: ReactNode }) {
  return (
    <TransportContext value={transport}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </TransportContext>
  );
}

const done: GatewayResult<string> = { ok: true, status: 200, data: 'done', etag: null, next: null };

it('hands the gateway and the argument to send and answers what it answers', async () => {
  const send = vi.fn((_gateway: Gateway, arg: number) => Promise.resolve(arg + 1));
  const { result } = renderHook(() => useWrite({ send }), { wrapper });
  await act(async () => {
    expect(await result.current.run(1)).toBe(2);
  });
  expect(send).toHaveBeenCalledWith(expect.anything(), 1);
});

it('is busy from the call until the answer', async () => {
  let answer: (value: string) => void = () => undefined;
  const { result } = renderHook(
    () =>
      useWrite({
        send: () =>
          new Promise<string>((resolve) => {
            answer = resolve;
          }),
      }),
    { wrapper },
  );
  expect(result.current.busy).toBe(false);
  let run: Promise<string> = Promise.resolve('');
  act(() => {
    run = result.current.run(undefined);
  });
  await waitFor(() => {
    expect(result.current.busy).toBe(true);
  });
  await act(async () => {
    answer('x');
    await run;
  });
  await waitFor(() => {
    expect(result.current.busy).toBe(false);
  });
});

it('tells onSuccess the answer and onSettled whatever came of it', async () => {
  const onSuccess = vi.fn();
  const onSettled = vi.fn();
  const { result } = renderHook(
    () => useGatewayWrite({ send: () => Promise.resolve(done), onSuccess, onSettled }),
    { wrapper },
  );
  await act(async () => {
    await result.current.run('arg');
  });
  expect(onSuccess).toHaveBeenCalledWith(done, 'arg');
  expect(onSettled).toHaveBeenCalledWith(done, 'arg');
});

it('throws a rejection from a plain write and settles with no result', async () => {
  const onSuccess = vi.fn();
  const onSettled = vi.fn();
  const { result } = renderHook(
    () => useWrite({ send: () => Promise.reject(new Error('down')), onSuccess, onSettled }),
    { wrapper },
  );
  await act(async () => {
    await expect(result.current.run(undefined)).rejects.toThrow('down');
  });
  expect(onSuccess).not.toHaveBeenCalled();
  expect(onSettled).toHaveBeenCalledWith(undefined, undefined);
});

it('answers a rejection as a defect from a gateway write and settles on it', async () => {
  const onSettled = vi.fn();
  const { result } = renderHook(
    () =>
      useGatewayWrite<undefined, string>({
        send: () => Promise.reject(new Error('down')),
        onSettled,
      }),
    { wrapper },
  );
  await act(async () => {
    expect(await result.current.run(undefined)).toEqual({ ok: false, kind: 'defect' });
  });
  expect(onSettled).toHaveBeenCalledWith({ ok: false, kind: 'defect' }, undefined);
});
