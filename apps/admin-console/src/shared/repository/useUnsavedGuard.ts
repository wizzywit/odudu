import { create } from 'zustand';

interface Departure {
  proceed: () => void;
  refuse: () => void;
}

interface UnsavedGuard {
  // Section id to the name a person knows it by.
  dirty: ReadonlyMap<string, string>;
  pending: Departure | null;
  // Bumped by each leave, which forgets every dirty section: one still on
  // screen afterwards, because the departure did not unmount it, says so again.
  generation: number;
  // Set once the page itself is being left, so the unload prompt stays quiet.
  released: boolean;
  setDirty: (section: string, label: string | null) => void;
  unsaved: () => string[];
  // True when the departure went ahead; false when it is held for an answer.
  request: (proceed: () => void, refuse?: () => void) => boolean;
  stay: () => void;
  leave: () => void;
  release: () => void;
  reset: () => void;
}

const NOTHING = (): void => undefined;

export const useUnsavedGuard = create<UnsavedGuard>()((set, get) => ({
  dirty: new Map(),
  pending: null,
  generation: 0,
  released: false,
  setDirty: (section, label) => {
    set(({ dirty }) => {
      if (label === null ? !dirty.has(section) : dirty.get(section) === label) return {};
      const next = new Map(dirty);
      if (label === null) next.delete(section);
      else next.set(section, label);
      return { dirty: next };
    });
    // A save that lands after the question was asked leaves nothing to lose.
    const { pending, dirty } = get();
    if (pending !== null && dirty.size === 0) {
      set({ pending: null });
      pending.proceed();
    }
  },
  unsaved: () => [...get().dirty.values()],
  request: (proceed, refuse = NOTHING) => {
    if (get().dirty.size === 0) {
      proceed();
      return true;
    }
    const replaced = get().pending;
    set({ pending: { proceed, refuse } });
    replaced?.refuse();
    return false;
  },
  stay: () => {
    const { pending } = get();
    set({ pending: null });
    pending?.refuse();
  },
  leave: () => {
    const { pending, generation } = get();
    set({ pending: null, dirty: new Map(), generation: generation + 1 });
    pending?.proceed();
  },
  release: () => {
    set({ released: true });
  },
  reset: () => {
    set({ pending: null, dirty: new Map(), released: false });
  },
}));
