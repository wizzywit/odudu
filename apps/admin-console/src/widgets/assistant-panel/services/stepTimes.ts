// When this panel saw each step begin, and how long it took once it saw it end.
// A step that was already finished when the panel first heard of it (a stored
// conversation) has no entry: its time is not known, and none is invented.
export type StepTimes = Readonly<Record<string, { start: number; ms: number | null }>>;

export const NO_TIMES: StepTimes = {};

// What the stream said of one tool call, and when it was heard. `waits` is a
// call that stopped for a person's decision: its time would be theirs, so none
// is kept.
export interface StepEvent {
  id: string;
  kind: 'begin' | 'end' | 'waits';
  at: number;
}

export function recordStep(previous: StepTimes, event: StepEvent): StepTimes {
  const seen = previous[event.id];
  if (event.kind === 'begin') {
    return seen === undefined
      ? { ...previous, [event.id]: { start: event.at, ms: null } }
      : previous;
  }
  if (seen === undefined) return previous;
  if (event.kind === 'waits') {
    return Object.fromEntries(Object.entries(previous).filter(([id]) => id !== event.id));
  }
  if (seen.ms !== null) return previous;
  return { ...previous, [event.id]: { start: seen.start, ms: Math.max(0, event.at - seen.start) } };
}

export function durationOf(times: StepTimes, id: string): number | null {
  return times[id]?.ms ?? null;
}
