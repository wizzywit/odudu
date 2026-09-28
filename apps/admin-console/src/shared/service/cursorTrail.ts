// The cursors of the pages visited so far, oldest first, kept in the URL so
// that Previous is a step back through them rather than a request the API
// cannot answer: a cursor only ever points forward.
export type CursorTrail = readonly string[];

export function currentCursor(trail: CursorTrail): string | undefined {
  return trail.at(-1);
}

export function advance(trail: CursorTrail, next: string): CursorTrail {
  return [...trail, next];
}

export function retreat(trail: CursorTrail): CursorTrail {
  return trail.slice(0, -1);
}
