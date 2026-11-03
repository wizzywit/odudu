import { create } from 'zustand';

export const useDrafts = create<{ count: number; forgetAll: () => void; keep: () => void }>(() => ({
  count: 0,
  forgetAll: () => undefined,
  keep: () => undefined,
}));
