export interface KeyedGate {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Lets at most `limit` keyed calls run at once. Each holds a pool connection
 * for its whole handler and the handler may take a second, so the limit has
 * to stay under half the pool for the calls to finish; a call over it waits
 * here, holding none.
 */
export function createKeyedGate(limit: number): KeyedGate {
  let active = 0;
  const waiting: (() => void)[] = [];
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (active >= limit) {
        await new Promise<void>((resolve) => {
          waiting.push(resolve);
        });
      } else {
        active += 1;
      }
      try {
        return await fn();
      } finally {
        const next = waiting.shift();
        if (next === undefined) active -= 1;
        else next();
      }
    },
  };
}

/** The most keyed calls a pool of `poolMax` connections can carry, one connection spare. */
export function keyedLimitFor(poolMax: number): number {
  return Math.max(1, Math.floor((poolMax - 1) / 2));
}
