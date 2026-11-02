import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Write } from '#/shared/repository/useWrite';
import type { GatewayResult } from '#/shared/services/result';
import { pending, problem } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { ACME_ADMIN } from '#/testing/tenantPaths';

type Key = readonly unknown[];

// What a deletion does to an entry the console holds: marks it stale, leaves it
// as it was (its own page may still be mounted and would read it again), or
// drops it.
type Fate = 'stale' | 'untouched' | 'removed';

interface Deletion {
  noun: string;
  resource: string;
  useDeletion: (tenant: string, id: string) => Write<void, GatewayResult<undefined>>;
  // The queries the server's answer is followed by a read of.
  invalidates: readonly Key[];
  // Held entries, set before the deletion of `x1`, and what becomes of each.
  cache: readonly { says: string; entries: readonly (readonly [Key, Fate])[] }[];
}

const gone = () => new Response(null, { status: 204 });

export function deletionContract({ noun, resource, useDeletion, invalidates, cache }: Deletion) {
  const path = `DELETE ${ACME_ADMIN}/${resource}/x1`;

  describe(`deleting a ${noun}`, () => {
    it(`deletes the ${noun}, reads its lists again once it is gone and answers the result`, async () => {
      const { wrapper, invalidated } = hookHarness({ [path]: gone });
      const { result } = renderHook(() => useDeletion('acme', 'x1'), { wrapper });
      let answer: Awaited<ReturnType<typeof result.current.run>> | undefined;
      await act(async () => {
        answer = await result.current.run();
      });
      expect(answer?.ok).toBe(true);
      for (const queryKey of invalidates) {
        expect(invalidated).toHaveBeenCalledWith({ queryKey });
      }
    });

    it('is busy from the press until the server answers', async () => {
      const { wrapper } = hookHarness({ [path]: pending() });
      const { result } = renderHook(() => useDeletion('acme', 'x1'), { wrapper });
      expect(result.current.busy).toBe(false);
      act(() => {
        result.current.run().catch(() => undefined);
      });
      await waitFor(() => {
        expect(result.current.busy).toBe(true);
      });
    });

    it('reads nothing again when the server refuses it, and answers the refusal', async () => {
      const { wrapper, queryClient, invalidated } = hookHarness({
        [path]: problem(409, 'about:blank', 'Conflict'),
      });
      const held = [...invalidates, ...cache.flatMap(({ entries }) => entries.map(([key]) => key))];
      for (const key of held) queryClient.setQueryData(key, 'held');
      const { result } = renderHook(() => useDeletion('acme', 'x1'), { wrapper });
      let answer: Awaited<ReturnType<typeof result.current.run>> | undefined;
      await act(async () => {
        answer = await result.current.run();
      });
      expect(answer?.ok).toBe(false);
      expect(invalidated).not.toHaveBeenCalled();
      expect(held.map((key) => queryClient.getQueryState(key)?.isInvalidated)).toEqual(
        held.map(() => false),
      );
    });

    for (const { says, entries } of cache) {
      it(says, async () => {
        const { wrapper, queryClient } = hookHarness({ [path]: gone });
        for (const [key] of entries) queryClient.setQueryData(key, 'held');
        const { result } = renderHook(() => useDeletion('acme', 'x1'), { wrapper });
        await act(async () => {
          await result.current.run();
        });
        const fateOf = (key: Key): Fate => {
          const invalidated = queryClient.getQueryState(key)?.isInvalidated;
          return invalidated === undefined ? 'removed' : invalidated ? 'stale' : 'untouched';
        };
        expect(entries.map(([key]) => ({ key, fate: fateOf(key) }))).toEqual(
          entries.map(([key, fate]) => ({ key, fate })),
        );
      });
    }
  });
}
