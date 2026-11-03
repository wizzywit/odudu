import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { createReadCache } from '#/shared/repository/readCache';
import { useInvalidate } from '#/shared/repository/useInvalidate';

function harness() {
  const queryClient = createReadCache();
  const invalidated = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, invalidated, wrapper };
}

it('invalidates each key it is given, by prefix', () => {
  const { invalidated, wrapper } = harness();
  const { result } = renderHook(() => useInvalidate(), { wrapper });
  result.current.invalidate(['list', 'acme'], ['picker', 'acme', 'roles']);
  expect(invalidated.mock.calls).toEqual([
    [{ queryKey: ['list', 'acme'] }],
    [{ queryKey: ['picker', 'acme', 'roles'] }],
  ]);
});

it('invalidates exactly the one key when asked to', () => {
  const { invalidated, wrapper } = harness();
  const { result } = renderHook(() => useInvalidate(), { wrapper });
  result.current.invalidateExact(['record', 'acme', 'roles/r1']);
  expect(invalidated).toHaveBeenCalledWith({
    queryKey: ['record', 'acme', 'roles/r1'],
    exact: true,
  });
});

it('marks only the queries under the key stale', () => {
  const { queryClient, wrapper } = harness();
  queryClient.setQueryData(['list', 'acme', 'roles'], 'held');
  queryClient.setQueryData(['list', 'other', 'roles'], 'held');
  const { result } = renderHook(() => useInvalidate(), { wrapper });
  result.current.invalidate(['list', 'acme']);
  expect(queryClient.getQueryState(['list', 'acme', 'roles'])?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(['list', 'other', 'roles'])?.isInvalidated).toBe(false);
});

it("lets a read again that fails stay the query's own to show, rejecting nothing", async () => {
  const unhandled = vi.fn();
  process.on('unhandledRejection', unhandled);
  const { queryClient, wrapper } = harness();
  let reads = 0;
  const { result } = renderHook(
    () => ({
      query: useQuery({
        queryKey: ['list', 'acme'],
        queryFn: () => {
          reads += 1;
          return reads === 1
            ? Promise.resolve('first')
            : Promise.reject(new Error('refetch failed'));
        },
      }),
      invalidation: useInvalidate(),
    }),
    { wrapper },
  );
  await waitFor(() => {
    expect(result.current.query.data).toBe('first');
  });
  act(() => {
    result.current.invalidation.invalidate(['list', 'acme']);
  });
  await waitFor(() => {
    expect(queryClient.getQueryState(['list', 'acme'])?.status).toBe('error');
  });
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  process.off('unhandledRejection', unhandled);
  expect(unhandled).not.toHaveBeenCalled();
});
