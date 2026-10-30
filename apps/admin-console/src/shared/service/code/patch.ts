export interface Snapshot {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

interface Place {
  start: number;
  end: number;
}

// One change to a text: what was at `from` and what replaced it, and where the
// selection stood before and after. Undo and redo cost the size of the change,
// never of the text.
export interface Patch {
  from: number;
  removed: string;
  inserted: string;
  before: Place;
  after: Place;
}

// The state of a text field as it stands, from the field itself.
export function snapshotOf(field: {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}): Snapshot {
  return {
    value: field.value,
    selectionStart: field.selectionStart,
    selectionEnd: field.selectionEnd,
  };
}

// The length of the text both share at its start. `hint` is where the change
// is expected to begin (the caret); a start that really is shared up to it is
// checked in one native comparison, and only what follows is read a character
// at a time. A wrong hint costs a read from the start.
function sharedStart(was: string, now: string, hint: number): number {
  const shortest = Math.min(was.length, now.length);
  let from = hint > 0 && hint <= shortest && was.startsWith(now.slice(0, hint)) ? hint : 0;
  while (from < shortest && was.charCodeAt(from) === now.charCodeAt(from)) from += 1;
  return from;
}

// The length of the text both share at its end, not reaching into the first
// `from` characters. `hint` is the length expected to be shared.
function sharedEnd(was: string, now: string, from: number, hint: number): number {
  const room = Math.min(was.length, now.length) - from;
  let length = hint > 0 && hint <= room && was.endsWith(now.slice(now.length - hint)) ? hint : 0;
  while (
    length < room &&
    was.charCodeAt(was.length - 1 - length) === now.charCodeAt(now.length - 1 - length)
  ) {
    length += 1;
  }
  return length;
}

// The one patch that turns `before` into `after`, or null when the text is
// the same. What is stored is the size of the change; finding it reads the
// start and the end of the text in native comparisons, guided by the selection
// the edit began with, and falls back to reading from both ends one character
// at a time when the guess was wrong.
export function patchBetween(before: Snapshot, after: Snapshot): Patch | null {
  const was = before.value;
  const now = after.value;
  const from = sharedStart(was, now, Math.min(before.selectionStart, after.selectionStart));
  const tail = sharedEnd(was, now, from, was.length - before.selectionEnd);
  const wasEnd = was.length - tail;
  const nowEnd = now.length - tail;
  if (wasEnd === from && nowEnd === from) return null;
  return {
    from,
    removed: was.slice(from, wasEnd),
    inserted: now.slice(from, nowEnd),
    before: { start: before.selectionStart, end: before.selectionEnd },
    after: { start: after.selectionStart, end: after.selectionEnd },
  };
}
