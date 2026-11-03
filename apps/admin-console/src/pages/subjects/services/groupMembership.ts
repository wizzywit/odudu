export interface Membership {
  id: string;
  // The path, or the id where the group is known by nothing else yet.
  path: string;
  description: string | null;
}

export function membershipsOf(
  ids: readonly string[],
  known: ReadonlyMap<string, { path: string; description?: string | null }>,
): Membership[] {
  return ids.map((id) => {
    const group = known.get(id);
    return { id, path: group?.path ?? id, description: group?.description ?? null };
  });
}

export function leftGroups(
  held: readonly { id: string; path: string }[],
  chosen: readonly string[],
): string[] {
  return held.filter((group) => !chosen.includes(group.id)).map((group) => group.path);
}

// A group is named by its path once it is known, and by its id before.
export function groupPathOf(known: ReadonlyMap<string, { path: string }>, id: string): string {
  return known.get(id)?.path ?? id;
}
