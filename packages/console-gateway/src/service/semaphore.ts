export type Semaphore = <T>(run: () => Promise<T>) => Promise<T>;

// A finishing run hands its slot straight to the next waiter, so a caller
// arriving in between cannot take it as well.
export function semaphore(limit: number): Semaphore {
  let running = 0;
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

// A refresh holds one pooled connection while its token call needs another,
// so at most two refreshes run at once and at least two connections stay free.
export function refreshConcurrency(poolMax: number): number {
  return Math.max(1, Math.min(2, poolMax - 2));
}
