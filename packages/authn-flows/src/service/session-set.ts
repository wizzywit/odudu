export interface EvictionCandidate {
  readonly id: string;
  readonly lastActiveAt: Date;
}

// Which sessions must go so that one more login fits under the cap. Ordered
// least recently active first, which is both the eviction order and the
// order a caller should report them in.
export function chooseEvictions(
  live: readonly EvictionCandidate[],
  cap: number,
): readonly string[] {
  const surplus = live.length + 1 - cap;
  if (surplus <= 0) return [];
  return [...live]
    .sort((a, b) => a.lastActiveAt.getTime() - b.lastActiveAt.getTime())
    .slice(0, surplus)
    .map((candidate) => candidate.id);
}
