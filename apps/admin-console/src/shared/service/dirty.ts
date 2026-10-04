export type Values = Readonly<Record<string, unknown>>;

export interface Draft<T extends Values> {
  base: T;
  edits: Partial<T>;
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]))
    );
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function startDraft<T extends Values>(base: T): Draft<T> {
  return { base, edits: {} };
}

export function edit<T extends Values, K extends keyof T & string>(
  draft: Draft<T>,
  field: K,
  value: T[K],
): Draft<T> {
  const others = Object.entries(draft.edits).filter(([key]) => key !== field);
  const kept = sameValue(value, draft.base[field]) ? others : [...others, [field, value]];
  return { base: draft.base, edits: Object.fromEntries(kept) as Partial<T> };
}

export function current<T extends Values>(draft: Draft<T>): T {
  return { ...draft.base, ...draft.edits };
}

export function dirtyFields<T extends Values>(draft: Draft<T>): (keyof T & string)[] {
  return Object.keys(draft.edits);
}

export function isDirty<T extends Values>(draft: Draft<T>): boolean {
  return dirtyFields(draft).length > 0;
}

export function discard<T extends Values>(draft: Draft<T>): Draft<T> {
  return startDraft(draft.base);
}

export interface Rebased<T extends Values> {
  draft: Draft<T>;
  // Edited here and changed on the server since: nothing merges on its own,
  // so the section shows theirs beside yours before it saves again.
  conflicts: readonly (keyof T & string)[];
}

// Another section's save returns the whole record: this one's edits survive
// it, and an edit the fresh record already holds stops counting as one.
export function rebase<T extends Values>(draft: Draft<T>, fresh: T): Rebased<T> {
  const conflicts = dirtyFields(draft).filter(
    (field) =>
      !sameValue(draft.base[field], fresh[field]) &&
      !sameValue(current(draft)[field], fresh[field]),
  );
  let next = startDraft(fresh);
  for (const field of dirtyFields(draft)) {
    next = edit(next, field, current(draft)[field]);
  }
  return { draft: next, conflicts };
}
