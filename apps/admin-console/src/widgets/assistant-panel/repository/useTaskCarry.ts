import { create } from 'zustand';
import type { TaskCarry } from '#/widgets/assistant-panel/types/carry';

interface Carried {
  carry: TaskCarry | null;
  hand: (carry: TaskCarry | null) => void;
}

const useCarried = create<Carried>()((set) => ({
  carry: null,
  hand: (carry) => {
    set({ carry });
  },
}));

// What the panel this one replaced left for this tenant, and the call that
// leaves this panel's own for the next. A panel that goes with nothing
// replacing it leaves nothing.
export function useTaskCarry(tenant: string): {
  carried: TaskCarry | null;
  hand: (carry: TaskCarry | null) => void;
} {
  const carry = useCarried((state) => state.carry);
  const hand = useCarried((state) => state.hand);
  return { carried: carry?.tenant === tenant ? carry : null, hand };
}
