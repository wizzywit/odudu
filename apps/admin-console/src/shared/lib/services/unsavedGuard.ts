export interface Departure {
  proceed: () => void;
  refuse: () => void;
}

// What the unsaved-changes guard decides from: the sections with unsaved
// edits (id to the name a person knows it by), the departure held for an
// answer, and how many leaves have forgotten the dirty sections.
export interface GuardState {
  dirty: ReadonlyMap<string, string>;
  pending: Departure | null;
  generation: number;
}

// The dirty sections with `section` marked under `label`, or cleared for a
// null label; null when that changes nothing.
export function withLabel(
  dirty: ReadonlyMap<string, string>,
  section: string,
  label: string | null,
): ReadonlyMap<string, string> | null {
  if (label === null ? !dirty.has(section) : dirty.get(section) === label) return null;
  const next = new Map(dirty);
  if (label === null) next.delete(section);
  else next.set(section, label);
  return next;
}

// Once nothing is left unsaved, a question asked has nothing to protect: its
// departure goes ahead, and the question is never left asking about nothing.
export function settledDeparture(state: GuardState): Departure | null {
  return state.pending !== null && state.dirty.size === 0 ? state.pending : null;
}

// With nothing dirty the departure goes ahead and the question still held is
// stale; otherwise this one is held and the one it replaces is refused.
export function requested(
  state: GuardState,
  proceed: () => void,
  refuse: () => void,
):
  | { now: true; stale: Departure | null }
  | { now: false; held: Departure; replaced: Departure | null } {
  if (state.dirty.size === 0) return { now: true, stale: state.pending };
  return { now: false, held: { proceed, refuse }, replaced: state.pending };
}

export function stayed(state: GuardState): {
  patch: { pending: null };
  answer: Departure | null;
} {
  return { patch: { pending: null }, answer: state.pending };
}

// Leaving forgets every dirty section, and counts itself so a section still
// on screen afterwards, which the departure did not unmount, says it is dirty again.
export function left(state: GuardState): {
  patch: { pending: null; dirty: ReadonlyMap<string, string>; generation: number };
  answer: Departure | null;
} {
  return {
    patch: { pending: null, dirty: new Map(), generation: state.generation + 1 },
    answer: state.pending,
  };
}

export function unsavedLabels(dirty: ReadonlyMap<string, string>): string[] {
  return [...dirty.values()];
}
