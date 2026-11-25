import { isRefused } from '#/shared/lib/services/failure';
import type { GatewayFailure, GatewayResult } from '#/shared/lib/services/result';

// A read as the hooks hand it to a service: the services judge what it says
// without knowing which hook made it.
export type Loaded<T> =
  { status: 'loading' } | { status: 'ready'; data: T } | { status: 'failed'; retry: () => void };

// `refused` is a 403: the read needs a capability the caller lacks.
export type Read<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'failed'; refused: boolean; retry: () => void };

export function readOutcome<T>(result: GatewayResult<T> | undefined, retry: () => void): Read<T> {
  if (result === undefined) return { status: 'loading' };
  if (result.ok) return { status: 'ready', data: result.data };
  return { status: 'failed', refused: isRefused(result), retry };
}

// A record the way the hooks hold it (status, data, failure) as a read.
export function recordRead<T>(record: {
  status: 'loading' | 'ready' | 'missing' | 'failed';
  data: T | undefined;
  failure: GatewayFailure | null;
  retry: () => void;
}): Read<T> {
  if (record.data !== undefined) return { status: 'ready', data: record.data };
  if (record.status === 'loading') return { status: 'loading' };
  return {
    status: 'failed',
    refused: record.failure === null ? false : isRefused(record.failure),
    retry: record.retry,
  };
}

export function loadedData<T>(
  read: { status: 'ready'; data: T } | { status: 'loading' | 'failed' | 'none' },
): T | undefined {
  return read.status === 'ready' ? read.data : undefined;
}

export function mapRead<T, U>(read: Read<T>, map: (data: T) => U): Read<U> {
  return read.status === 'ready' ? { status: 'ready', data: map(read.data) } : read;
}

// How long a read just made stays fresh, so that what a page starts early is
// not asked for again by the tab that shows it a moment later.
export const RECENT_READ_MS = 10_000;

// How long a read stays fresh. What never changes under its key is kept and not
// asked for again on a window focus; a `recent` read is kept for the moment
// above; anything else is read again as the client's defaults say.
export function freshness(
  immutable: boolean,
  recent = false,
): {
  staleTime?: number;
  refetchOnWindowFocus?: boolean;
} {
  if (immutable) return { staleTime: Infinity, refetchOnWindowFocus: false };
  return recent ? { staleTime: RECENT_READ_MS } : {};
}

// What a `fresh` read asks of the cache: nothing kept once it is not wanted,
// and no read again on a window focus.
export function freshCache(fresh: boolean): { gcTime?: number; refetchOnWindowFocus?: boolean } {
  return fresh ? { gcTime: 0, refetchOnWindowFocus: false } : {};
}

// What a read answers: a `fresh` one answers nothing while it is not asked or
// is being read, so no earlier answer is taken for this one.
export function answerOf<T>(
  fresh: boolean,
  state: { asked: boolean; fetching: boolean },
  data: GatewayResult<T> | undefined,
): GatewayResult<T> | undefined {
  return fresh && (!state.asked || state.fetching) ? undefined : data;
}

// How long a read is kept and when it is read again, for the options it was asked with.
export function cachePolicy(options: {
  immutable: boolean;
  recent: boolean;
  fresh: boolean;
}): ReturnType<typeof freshness> & ReturnType<typeof freshCache> {
  return { ...freshness(options.immutable, options.recent), ...freshCache(options.fresh) };
}
