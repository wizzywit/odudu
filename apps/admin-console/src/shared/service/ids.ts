export function sortedIds(ids: readonly string[]): string[] {
  return [...ids].sort();
}

// The chosen values that `order` offers, in the order it offers them.
export function inOrderOf<T extends string>(order: readonly T[], chosen: Iterable<string>): T[] {
  const set = new Set(chosen);
  return order.filter((each) => set.has(each));
}

export function removedFrom<T extends string>(before: readonly T[], after: readonly string[]): T[] {
  return before.filter((id) => !after.includes(id));
}
