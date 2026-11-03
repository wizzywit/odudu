import { create } from 'zustand';

export const useStore = create<{ sources: Set<string> }>(() => {
  const sources = new Set<string>();
  return { sources };
});
