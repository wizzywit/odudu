export function useNames(names: string[]): string {
  return new Intl.ListFormat('en-GB').format(names);
}
