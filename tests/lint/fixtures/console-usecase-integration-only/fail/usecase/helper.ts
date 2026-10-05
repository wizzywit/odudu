function sorted(ids: string[]): string[] {
  return [...ids].sort();
}

const unique = (ids: string[]): string[] => [...new Set(ids)];

export function useIds(ids: string[]): string[] {
  return unique(sorted(ids));
}
