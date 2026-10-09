import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { createQueryClient } from '#/shared/repository/queryClient.ts';
import { useFreshRead } from '#/shared/repository/useFreshRead.ts';

const client = createQueryClient();

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

it('asks the server every time, never answering from the cache', async () => {
  const ask = vi.fn(() => Promise.resolve('acme'));
  const { result } = renderHook(() => useFreshRead(), { wrapper });
  await act(async () => {
    expect(await result.current.read(['find', 'acme'], ask)).toBe('acme');
    expect(await result.current.read(['find', 'acme'], ask)).toBe('acme');
  });
  expect(ask).toHaveBeenCalledTimes(2);
});

it('is pending while a read is in flight, and only then', async () => {
  let answer: (value: string) => void = () => undefined;
  const { result } = renderHook(() => useFreshRead(), { wrapper });
  expect(result.current.pending).toBe(false);
  let read: Promise<string> = Promise.resolve('');
  act(() => {
    read = result.current.read(
      ['find', 'acme'],
      () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
    );
  });
  expect(result.current.pending).toBe(true);
  await act(async () => {
    answer('acme');
    await read;
  });
  expect(result.current.pending).toBe(false);
});

it('keeps nothing it read in the cache once it answers', async () => {
  const { result } = renderHook(() => useFreshRead(), { wrapper });
  await act(async () => {
    await result.current.read(['export', 'acme'], () => Promise.resolve('secret text'));
  });
  expect(client.getQueryCache().find({ queryKey: ['export', 'acme'] })).toBeUndefined();
});
