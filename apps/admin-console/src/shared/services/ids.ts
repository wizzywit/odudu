// Each item by its id; where lists share one, the later list's item is kept.
export function indexById<T extends { id: string }>(
  ...lists: readonly (readonly T[])[]
): ReadonlyMap<string, T> {
  return new Map(lists.flat().map((item) => [item.id, item]));
}

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

export function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

// What a person-or-thing with an optional username is called: the username,
// else its id. `label` names the id when no username exists ("service s2").
export function nameOrId(named: { id: string; username: string | null }, label?: string): string {
  if (named.username !== null) return named.username;
  return label === undefined ? named.id : `${label} ${named.id}`;
}
