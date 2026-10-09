import { sameValue, type Values } from '#/shared/service/dirty.ts';

// `conflict`, `stale` and `unread` all follow a 412: `conflict` while a
// field edited here was changed there too, `stale` when the edits sit on
// the fresh read untouched and only need saving again, `unread` when the
// fresh read itself failed and there is nothing yet to save over.
export type SaveStatus =
  'idle' | 'saving' | 'saved' | 'invalid' | 'conflict' | 'stale' | 'unread' | 'refused' | 'failed';

// `changed`: another administrator saved these fields. `kept`: edits kept
// across a sign-in meet a record that has moved on, and what changed in
// between cannot be known.
export type ConflictSource = 'changed' | 'kept';

export const BLOCKED_BY_CONFLICT = 'Keep yours or take theirs before saving.';

export const BLOCKED_UNREAD = 'Load the newer version before saving.';

export const BLOCKED_GONE =
  'This record was deleted since you opened it, so there is nothing to save to.';

export type SavePhase = Exclude<SaveStatus, 'conflict'>;

// One section of a record between its first edit and its save. Every
// transition is a function of the state alone; the hook only holds it.
export interface SectionState<T extends Values> {
  base: T;
  etag: string;
  edits: Partial<T>;
  conflicts: readonly (keyof T & string)[];
  source: ConflictSource;
  phase: SavePhase;
  fieldErrors: Readonly<Record<string, string>>;
  message: string | null;
}

export interface SectionField<V> {
  value: V;
  label: string;
  kind: 'plain' | 'secret';
  describe?: ((value: unknown) => string) | undefined;
}

export type SectionFields<T extends Values> = {
  readonly [K in keyof T]: SectionField<T[K]>;
};

export function keysOf<T extends Values>(values: T): (keyof T & string)[] {
  return Object.keys(values);
}

export function fieldValues<T extends Values>(fields: SectionFields<T>): T {
  const names = Object.keys(fields) as (keyof T & string)[];
  return Object.fromEntries(names.map((name) => [name, fields[name].value])) as T;
}

export function changedFrom<T extends Values>(base: T, values: Values): Partial<T> {
  return Object.fromEntries(
    keysOf(base)
      .filter((name) => Object.hasOwn(values, name) && !sameValue(values[name], base[name]))
      .map((name) => [name, values[name]]),
  ) as Partial<T>;
}

export function withoutFields<T extends Values>(
  edits: Partial<T>,
  fields: readonly string[],
): Partial<T> {
  return Object.fromEntries(
    Object.entries(edits).filter(([name]) => !fields.includes(name)),
  ) as Partial<T>;
}
