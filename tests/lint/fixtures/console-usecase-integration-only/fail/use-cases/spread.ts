export function useValues(base: Record<string, string>, edits: Record<string, string>) {
  const merged = { ...base, ...edits };
  return merged;
}

export const useBoth = (a: object, b: object) => {
  const all = { ...a, kept: 1, ...b };
  return all;
};

export function useLists(a: number[], b: number[]) {
  return [...a, ...b];
}

export function useAssigned(a: object, b: object) {
  return Object.assign({}, a, b);
}
