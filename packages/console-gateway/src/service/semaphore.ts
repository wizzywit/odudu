export type Semaphore = <T>(run: () => Promise<T>) => Promise<T>;

// A finishing run hands its slot straight to the next waiter, so a caller
// arriving in between cannot take it as well.
export function semaphore(limit: number): Semaphore {
  let running = 0;
  // One entry per caller waiting for a slot, each an open console request: at
  // most the refreshes in flight at once, each of a different console session
  // (single-flight merges the rest), so no more than the sessions signed in.
  const waiting: (() => void)[] = [];
  const acquire = async (): Promise<void> => {
    if (running < limit) {
      running += 1;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  };
  const release = (): void => {
    const next = waiting.shift();
    if (next === undefined) running -= 1;
    else next();
  };
  return async <T>(run: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await run();
    } finally {
      release();
    }
  };
}

// A refresh holds three pooled connections at once: the session's row lock, the
// token request's transaction and, for a refresh token, the rotation's own
// (committed on a connection of its own so reuse detection survives a rollback).
// At most two run at once, and only as many as leave two connections free.
export function refreshConcurrency(poolMax: number): number {
  return Math.max(1, Math.min(2, Math.floor((poolMax - 2) / 3)));
}
