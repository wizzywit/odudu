// What a token's grant may change before the person signs in again. A write
// token lives ten minutes and is never refreshed, so these bound what one
// confused or misled agent can make in that time.
export interface BudgetLimits {
  readonly mutating: number;
  readonly creates: number;
}

export const WRITE_BUDGET: BudgetLimits = { mutating: 20, creates: 10 };

// A create is also a mutating call: it spends one of each.
export type BudgetKind = 'mutating' | 'create';

// The spending of one grant. `reserve` is atomic: of any number of calls asking
// at once, no more than the limit are told yes. `release` gives back a call
// known to have changed nothing.
export interface WriteBudget {
  reserve(kind: BudgetKind): Promise<boolean>;
  release(kind: BudgetKind): Promise<void>;
}

// A budget held in memory, for the one process a stdio run is and for tests.
export function memoryWriteBudget(limits: BudgetLimits = WRITE_BUDGET): WriteBudget {
  let mutating = 0;
  let creates = 0;
  return {
    reserve(kind) {
      const create = kind === 'create';
      if (mutating >= limits.mutating || (create && creates >= limits.creates)) {
        return Promise.resolve(false);
      }
      mutating += 1;
      if (create) creates += 1;
      return Promise.resolve(true);
    },
    release(kind) {
      mutating = Math.max(0, mutating - 1);
      if (kind === 'create') creates = Math.max(0, creates - 1);
      return Promise.resolve();
    },
  };
}
