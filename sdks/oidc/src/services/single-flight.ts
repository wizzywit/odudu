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

export interface SingleFlightRules<T> {
  successorKeys: (value: T) => string[];
  // Whether an operation that failed with this error certainly changed
  // nothing, so the next one may go ahead from the last good value.
  retryable: (error: unknown) => boolean;
  // The error a queued operation is rejected with when its predecessor failed
  // in a way that is not retryable.
  abandoned: (error: unknown) => Error;
}

// Runs the operations of a chain one at a time. A chain starts at its first
// caller's key and takes in each key a settled operation names through
// `successorKeys`, so a caller holding a value an earlier operation produced
// joins the same queue. A caller whose tag matches the last operation queued
// shares its promise; any other caller queues behind the tail. It starts with
// the latest value that settled well when the predecessor failed retryably,
// and is rejected when the outcome of the predecessor is unknown. A chain is
// dropped when its last operation settles, so the map is bounded by the
// operations in flight.
export class SingleFlight<T> {
  private readonly chains = new Map<string, Chain<T>>();
  private readonly rules: SingleFlightRules<T>;

  constructor(rules: SingleFlightRules<T>) {
    this.rules = rules;
  }

  run(key: string, tag: string, start: (latest: T | undefined) => Promise<T>): Promise<T> {
    const chain = this.chains.get(key) ?? this.open(key);
    if (chain.tail?.tag === tag) return chain.tail.promise;
    const turn =
      chain.tail?.promise.then(noop, (error: unknown) => {
        if (!this.rules.retryable(error)) throw this.rules.abandoned(error);
      }) ?? Promise.resolve();
    chain.pending += 1;
    const promise: Promise<T> = turn
      .then(() => start(chain.latest))
      .then((value) => {
        chain.latest = value;
        for (const successor of this.rules.successorKeys(value)) {
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
  // A predecessor that succeeded only orders the queue.
}
