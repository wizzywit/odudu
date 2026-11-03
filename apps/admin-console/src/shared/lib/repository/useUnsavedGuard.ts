import { create } from 'zustand';
import {
  left,
  requested,
  settledDeparture,
  stayed,
  unsavedLabels,
  withLabel,
  type Departure,
} from '#/shared/lib/services/unsavedGuard';

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
  // A section gone from the screen, which saved nothing.
  forget: (section: string) => void;
  unsaved: () => string[];
  // True when the departure went ahead; false when it is held for an answer.
  request: (proceed: () => void, refuse?: () => void) => boolean;
  stay: () => void;
  leave: () => void;
  release: () => void;
  // Back from the back-forward cache, where leaving is asked about again.
  restore: () => void;
  reset: () => void;
}

const NOTHING = (): void => undefined;

export const useUnsavedGuard = create<UnsavedGuard>()((set, get) => {
  const settle = (): void => {
    const settled = settledDeparture(get());
    if (settled === null) return;
    set({ pending: null });
    settled.proceed();
  };
  return {
    dirty: new Map(),
    pending: null,
    generation: 0,
    released: false,
    setDirty: (section, label) => {
      const next = withLabel(get().dirty, section, label);
      set(next === null ? {} : { dirty: next });
      settle();
    },
    forget: (section) => {
      get().setDirty(section, null);
    },
    unsaved: () => unsavedLabels(get().dirty),
    request: (proceed, refuse = NOTHING) => {
      const asked = requested(get(), proceed, refuse);
      if (asked.now) {
        set({ pending: null });
        asked.stale?.refuse();
        proceed();
        return true;
      }
      set({ pending: asked.held });
      asked.replaced?.refuse();
      return false;
    },
    stay: () => {
      const { patch, answer } = stayed(get());
      set(patch);
      answer?.refuse();
    },
    leave: () => {
      const { patch, answer } = left(get());
      set(patch);
      answer?.proceed();
    },
    release: () => {
      set({ released: true });
    },
    restore: () => {
      set({ released: false });
    },
    reset: () => {
      set({ pending: null, dirty: new Map(), released: false });
    },
  };
});
