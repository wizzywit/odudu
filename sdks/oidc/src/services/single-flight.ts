interface Flight<T> {
  tag: string;
  promise: Promise<T>;
}

// The operations that follow one another from a single starting key.
interface Chain<T> {
  keys: Set<string>;
  tail: Flight<T> | undefined;
  latest: T | undefined;
  pending: number;
}

// Runs the operations of a chain one at a time. A chain starts at the key of
// its first caller and takes in each key a settled operation names through
// `successorKeys`, so a caller holding a value an earlier operation produced
// joins the same queue. A caller whose tag matches the last operation queued
// gets its promise, so both settle with the same value or error; any other
// caller queues behind the tail and starts, handed the latest value that
// settled well (undefined before one has). A failure leaves that value as it
// was. A chain is dropped when its last operation settles, so the map is
// bounded by the operations in flight.
export class SingleFlight<T> {
  private readonly chains = new Map<string, Chain<T>>();

  private readonly successorKeys: (value: T) => string[];

  constructor(successorKeys: (value: T) => string[]) {
    this.successorKeys = successorKeys;
  }

  run(key: string, tag: string, start: (latest: T | undefined) => Promise<T>): Promise<T> {
    const chain = this.chains.get(key) ?? this.open(key);
    if (chain.tail?.tag === tag) return chain.tail.promise;
    const turn = chain.tail?.promise.then(noop, noop) ?? Promise.resolve();
    chain.pending += 1;
    const promise: Promise<T> = turn
      .then(() => start(chain.latest))
      .then((value) => {
        chain.latest = value;
        for (const successor of this.successorKeys(value)) {
          chain.keys.add(successor);
          this.chains.set(successor, chain);
        }
        return value;
      })
      .finally(() => {
        chain.pending -= 1;
        if (chain.pending === 0) this.close(chain);
      });
    chain.tail = { tag, promise };
    return promise;
  }

  private open(key: string): Chain<T> {
    const chain: Chain<T> = {
      keys: new Set([key]),
      tail: undefined,
      latest: undefined,
      pending: 0,
    };
    this.chains.set(key, chain);
    return chain;
  }

  private close(chain: Chain<T>): void {
    for (const key of chain.keys) {
      if (this.chains.get(key) === chain) this.chains.delete(key);
    }
  }
}

function noop(): void {
  // A predecessor's outcome only orders the queue; its caller handles it.
}
