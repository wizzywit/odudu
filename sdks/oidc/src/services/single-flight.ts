// Runs one operation per key at a time: a caller that arrives while the
// operation for its key is in flight gets that operation's promise, so all of
// them settle with the same value or the same error. An entry lives only as
// long as its operation, which bounds the map by the operations in flight.
export class SingleFlight<T> {
  private readonly flights = new Map<string, Promise<T>>();

  run(key: string, start: () => Promise<T>): Promise<T> {
    const existing = this.flights.get(key);
    if (existing !== undefined) return existing;
    const flight = start().finally(() => {
      this.flights.delete(key);
    });
    this.flights.set(key, flight);
    return flight;
  }
}
