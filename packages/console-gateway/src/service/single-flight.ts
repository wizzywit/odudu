export type SingleFlight<K, V> = (key: K, run: () => Promise<V>) => Promise<V>;

// A caller arriving while a call for its key is in flight waits for that
// call's result instead of starting its own.
export function singleFlight<K, V>(): SingleFlight<K, V> {
  // One entry per key with a call in flight, removed when it settles: at most
  // one per console session refreshing, and a refresh runs two at a time
  // (`refreshConcurrency`), so the rest of the entries are waiting, not working.
  const inFlight = new Map<K, Promise<V>>();
  return (key, run) => {
    const pending = inFlight.get(key);
    if (pending !== undefined) return pending;
    const started = run().finally(() => inFlight.delete(key));
    inFlight.set(key, started);
    return started;
  };
}
