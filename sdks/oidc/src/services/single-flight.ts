interface Flight<T> {
  tag: string;
  promise: Promise<T>;
}

// Runs one operation per key at a time. A caller whose tag matches the latest
// flight for its key gets that flight's promise, so all of them settle with the
// same value or error. A caller with another tag waits for that flight to
// settle and then starts, handed the value it produced (undefined when it
// failed): the two never overlap. The map holds one entry per key with a
// flight in progress and an entry is deleted when its flight settles, so it
// is bounded by the operations in flight.
export class SingleFlight<T> {
  private readonly flights = new Map<string, Flight<T>>();

  run(key: string, tag: string, start: (after: T | undefined) => Promise<T>): Promise<T> {
    const current = this.flights.get(key);
    if (current?.tag === tag) return current.promise;
    const promise: Promise<T> = (
      current === undefined
        ? start(undefined)
        : current.promise.then(
            (value) => start(value),
            () => start(undefined),
          )
    ).finally(() => {
      if (this.flights.get(key)?.promise === promise) this.flights.delete(key);
    });
    this.flights.set(key, { tag, promise });
    return promise;
  }
}
