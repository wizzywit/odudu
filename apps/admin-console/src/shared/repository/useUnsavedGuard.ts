import { create } from 'zustand';

interface UnsavedGuard {
  // Section id to the name a person knows it by.
  readonly dirty: ReadonlyMap<string, string>;
  readonly pending: { readonly proceed: () => void } | null;
  readonly setDirty: (section: string, label: string | null) => void;
  readonly unsaved: () => string[];
  // True when the departure went ahead; false when it is held for an answer.
  readonly request: (proceed: () => void) => boolean;
  readonly stay: () => void;
  readonly leave: () => void;
  readonly reset: () => void;
}

export const useUnsavedGuard = create<UnsavedGuard>()((set, get) => ({
  dirty: new Map(),
  pending: null,
  setDirty: (section, label) => {
    set(({ dirty }) => {
      const next = new Map(dirty);
      if (label === null) next.delete(section);
      else next.set(section, label);
      return { dirty: next };
    });
  },
  unsaved: () => [...get().dirty.values()],
  request: (proceed) => {
    if (get().dirty.size === 0) {
      proceed();
      return true;
    }
    set({ pending: { proceed } });
    return false;
  },
  stay: () => {
    set({ pending: null });
  },
  leave: () => {
    const { pending } = get();
    set({ pending: null, dirty: new Map() });
    pending?.proceed();
  },
  reset: () => {
    set({ pending: null, dirty: new Map() });
  },
}));
