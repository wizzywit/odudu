import { useQuery } from '@tanstack/react-query';
import { useInvalidate } from '#/shared/repository/useInvalidate';
import { freshness, readOutcome, type Read } from '#/shared/service/read';
import type { GatewayResult } from '#/shared/transport/gateway';

// One read a tab shows, keyed so a change elsewhere can ask for it again.
// An `immutable` read is of something that never changes under its key, so it
// is not asked for again when the window regains focus; a `recent` one is
// kept for a moment, for a page that starts it before the tab that shows it.
export function useRead<T>(
  key: readonly unknown[],
  asked: boolean,
  read: () => Promise<GatewayResult<T>>,
  { immutable = false, recent = false }: { immutable?: boolean; recent?: boolean } = {},
): Read<T> {
  const { invalidateExact } = useInvalidate();
  const query = useQuery({
    queryKey: key,
    queryFn: read,
    enabled: asked,
    ...freshness(immutable, recent),
  });
  return readOutcome(query.data, () => {
    invalidateExact(key);
  });
}
