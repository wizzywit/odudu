import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it } from 'vitest';
import { useKeyLane } from '#/pages/signing-keys/repository/useKeyLane';
import { createReadCache } from '#/shared/repository/readCache';
import { TransportContext } from '#/shared/transport/useTransport';
import { fakeTransport, json, problem, type Answer } from '#/testing/fakeTransport';
import { KEYS, READY_KEY, signingKey } from '#/testing/keysFixtures';

function harness(routes: Record<string, Answer>) {
  const fake = fakeTransport(routes);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TransportContext value={fake.transport}>
      <QueryClientProvider client={createReadCache()}>{children}</QueryClientProvider>
    </TransportContext>
  );
  return { ...fake, wrapper };
}

it('asks for one status only and says it is ready with its rows', async () => {
  const { wrapper, sent } = harness({ [`GET ${KEYS}`]: json({ items: [READY_KEY] }) });
  const { result } = renderHook(() => useKeyLane('acme', 'rotating'), { wrapper });
  await waitFor(() => {
    expect(result.current.status).toBe('ready');
  });
  expect(result.current.rows).toEqual([READY_KEY]);
  expect(sent[0]?.search.get('status')).toBe('rotating');
  expect(result.current.next).toBeNull();
});

it('follows the cursor a page at a time and keeps the pages it has', async () => {
  const second = signingKey('k-2', 'retired');
  const { wrapper, sent } = harness({
    [`GET ${KEYS}`]: (request) =>
      json(
        request.search.get('cursor') === null
          ? { items: [READY_KEY], next: 'c2' }
          : { items: [second] },
      )(request),
  });
  const { result } = renderHook(() => useKeyLane('acme', 'retired'), { wrapper });
  await waitFor(() => {
    expect(result.current.next).toBe('c2');
  });
  act(() => {
    result.current.loadMore();
  });
  await waitFor(() => {
    expect(result.current.rows).toHaveLength(2);
  });
  expect(sent.at(-1)?.search.get('cursor')).toBe('c2');
});

it('names a refusal as refused and any other failure as failed', async () => {
  const refused = harness({ [`GET ${KEYS}`]: problem(403, 'about:blank', 'Forbidden') });
  const one = renderHook(() => useKeyLane('acme', 'active'), { wrapper: refused.wrapper });
  await waitFor(() => {
    expect(one.result.current.status).toBe('refused');
  });
  const failed = harness({ [`GET ${KEYS}`]: problem(500, 'about:blank', 'Error') });
  const two = renderHook(() => useKeyLane('acme', 'active'), { wrapper: failed.wrapper });
  await waitFor(() => {
    expect(two.result.current.status).toBe('failed');
  });
});
