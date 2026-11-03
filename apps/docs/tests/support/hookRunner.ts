// A minimal stand-in for React's hooks, for a test that has to see a hook's
// state and effects without a DOM. A test mocks 'react' with `fakeReact`.
type Cleanup = (() => void) | undefined;

interface Slot {
  value?: unknown;
  deps?: unknown[];
  cleanup?: Cleanup;
  wrapper?: (...args: never[]) => unknown;
  latest?: (...args: never[]) => unknown;
}

interface Pending {
  slot: Slot;
  run: () => Cleanup;
  deps: unknown[] | undefined;
}

interface Instance {
  slots: Slot[];
  cursor: number;
  pending: Pending[];
  render: () => void;
  rendering: boolean;
  dirty: boolean;
}

let active: Instance | undefined;

function slotOf(): { instance: Instance; slot: Slot; fresh: boolean } {
  if (active === undefined) throw new Error('a hook ran outside mount()');
  const index = active.cursor;
  active.cursor += 1;
  const fresh = active.slots[index] === undefined;
  active.slots[index] ??= {};
  return { instance: active, slot: active.slots[index], fresh };
}

function changed(before: unknown[] | undefined, after: unknown[] | undefined): boolean {
  if (before === undefined || after === undefined) return true;
  return before.length !== after.length || before.some((value, i) => !Object.is(value, after[i]));
}

function isDirty(instance: Instance): boolean {
  return instance.dirty;
}

function request(instance: Instance): void {
  if (instance.rendering) instance.dirty = true;
  else instance.render();
}

function useState<T>(initial: T | (() => T)): [T, (next: T | ((before: T) => T)) => void] {
  const { instance, slot, fresh } = slotOf();
  if (fresh) slot.value = typeof initial === 'function' ? (initial as () => T)() : initial;
  const set = (next: T | ((before: T) => T)): void => {
    slot.value = typeof next === 'function' ? (next as (before: T) => T)(slot.value as T) : next;
    request(instance);
  };
  return [slot.value as T, set];
}

function useReducer<S, A>(
  reducer: (state: S, action: A) => S,
  initial: S,
): [S, (action: A) => void] {
  const { instance, slot, fresh } = slotOf();
  if (fresh) slot.value = initial;
  return [
    slot.value as S,
    (action) => {
      slot.value = reducer(slot.value as S, action);
      request(instance);
    },
  ];
}

function useRef<T>(initial: T): { current: T } {
  const { slot, fresh } = slotOf();
  if (fresh) slot.value = { current: initial };
  return slot.value as { current: T };
}

function useEffect(run: () => Cleanup, deps?: unknown[]): void {
  const { instance, slot } = slotOf();
  instance.pending.push({ slot, run, deps });
}

function useEffectEvent<A extends unknown[], R>(run: (...args: A) => R): (...args: A) => R {
  const { slot } = slotOf();
  slot.latest = run;
  slot.wrapper ??= (...args) => (slot.latest as (...inner: never[]) => unknown)(...args);
  return slot.wrapper as unknown as (...args: A) => R;
}

function useId(): string {
  return ':r0:';
}

function useSyncExternalStore<T>(_subscribe: unknown, snapshot: () => T): T {
  slotOf();
  return snapshot();
}

export const fakeReact = {
  useState,
  useReducer,
  useRef,
  useEffect,
  useEffectEvent,
  useId,
  useSyncExternalStore,
};

export interface Mounted<T> {
  current: () => T;
  unmount: () => void;
}

export function mount<T>(hook: () => T): Mounted<T> {
  let result: T | undefined;
  const instance: Instance = {
    slots: [],
    cursor: 0,
    pending: [],
    rendering: false,
    dirty: false,
    render: () => {
      do {
        instance.dirty = false;
        instance.cursor = 0;
        instance.pending = [];
        instance.rendering = true;
        active = instance;
        try {
          result = hook();
        } finally {
          active = undefined;
        }
        for (const effect of instance.pending) {
          if (!changed(effect.slot.deps, effect.deps)) continue;
          effect.slot.cleanup?.();
          effect.slot.deps = effect.deps;
          effect.slot.cleanup = effect.run();
        }
        instance.rendering = false;
      } while (isDirty(instance));
    },
  };
  instance.render();
  return {
    current: () => result as T,
    unmount: () => {
      for (const slot of instance.slots) slot.cleanup?.();
    },
  };
}
