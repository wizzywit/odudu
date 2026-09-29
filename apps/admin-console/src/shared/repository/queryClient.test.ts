import { MutationObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '#/shared/repository/queryClient.ts';

describe('createQueryClient', () => {
  const defaults = createQueryClient().getDefaultOptions();

  it('refetches reads when the window regains focus', () => {
    expect(defaults.queries?.refetchOnWindowFocus).toBe(true);
  });

  it('leaves read retries to the transport, so they are not doubled', () => {
    expect(defaults.queries?.retry).toBe(false);
  });

  it('never retries a mutation', () => {
    expect(defaults.mutations?.retry).toBe(false);
  });

  it('drops a mutation result, a one-time secret among them, once nothing observes it', () => {
    expect(defaults.mutations?.gcTime).toBe(0);
  });

  it('holds no finished mutation a second after its observer has gone', async () => {
    vi.useFakeTimers();
    try {
      const client = createQueryClient();
      const observer = new MutationObserver(client, {
        mutationFn: () => Promise.resolve({ secret: 'correct-horse' }),
      });
      const unsubscribe = observer.subscribe(() => undefined);
      await observer.mutate();
      unsubscribe();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(client.getMutationCache().getAll()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives each caller its own client', () => {
    expect(createQueryClient()).not.toBe(createQueryClient());
  });
});
