export function within(path: string, above: string): boolean {
  return path === above || path.startsWith(`${above}/`);
}

// ADR 0039: a token's groups claim carries the path, which the name is part of.
export const NAME_FIXED =
  "A group's name is fixed once it is made: the groups claim carries its path, and a relying party that matches on it would otherwise pass or fail by a token's age.";
