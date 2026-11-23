// One run per key at a time: a caller arriving while a run is in progress gets
// that run's promise. The map holds only runs in progress.
export function createInFlight<T>(): (key: string, run: () => Promise<T>) => Promise<T> {
  const running = new Map<string, Promise<T>>();
  return (key, run) => {
    const current = running.get(key);
    if (current !== undefined) return current;
    const started = run().finally(() => {
      running.delete(key);
    });
    running.set(key, started);
    return started;
  };
}
