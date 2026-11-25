import { useQuery } from '@tanstack/react-query';
import { useInvalidate } from '#/shared/lib/repository/useInvalidate';
import { answerOf, cachePolicy, readOutcome, type Read } from '#/shared/lib/services/read';
import type { GatewayResult } from '#/shared/api/transport/gateway';

// One read a tab shows, keyed so a change elsewhere can ask for it again.
// An `immutable` read is of something that never changes under its key, so it
// is not asked for again when the window regains focus; a `recent` one is
// kept for a moment, for a page that starts it before the tab that shows it.
// A `fresh` read answers only what the server said for this ask: nothing is
// kept once it is not wanted, it is not read again on a window focus, and
// while it is being read again it is loading, so a confirmation that states
// a consequence never states an earlier one.
export function useRead<T>(
  key: readonly unknown[],
  asked: boolean,
  read: () => Promise<GatewayResult<T>>,
  {
    immutable = false,
    recent = false,
    fresh = false,
  }: { immutable?: boolean; recent?: boolean; fresh?: boolean } = {},
): Read<T> {
  const { invalidateExact } = useInvalidate();
  const query = useQuery({
    queryKey: key,
    queryFn: read,
    enabled: asked,
    ...cachePolicy({ immutable, recent, fresh }),
  });
  const answer = answerOf(fresh, { asked, fetching: query.isFetching }, query.data);
  return readOutcome(answer, () => {
    invalidateExact(key);
  });
}
