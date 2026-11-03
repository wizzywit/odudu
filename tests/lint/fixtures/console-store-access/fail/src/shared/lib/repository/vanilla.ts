import { createStore } from 'zustand/vanilla';

export const useVanilla = createStore<{ go: () => void }>()(() => ({ go() {} }));
