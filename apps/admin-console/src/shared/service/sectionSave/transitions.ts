import type { Conflict } from '#/shared/service/conflict';
import { edit as editDraft, rebase, sameValue, type Values } from '#/shared/service/dirty';
import type { KeptDraft } from '#/shared/service/drafts';
import { uniqueIds } from '#/shared/service/ids';
import {
  BLOCKED_BY_CONFLICT,
  BLOCKED_GONE,
  BLOCKED_UNREAD,
  type SavePhase,
  type SaveStatus,
  type SectionFields,
  type SectionState,
  changedFrom,
  keysOf,
  withoutFields,
} from '#/shared/service/sectionSave/state';

// A kept draft made against an older version cannot be rebased, since the
// values it was made against are gone: every edit is then shown beside what
// the record holds now.
export function initialSection<T extends Values>(
  fresh: T,
  etag: string,
  restored: KeptDraft | null,
): SectionState<T> {
  const edits = restored === null ? {} : changedFrom(fresh, restored.values);
  const conflicts = restored !== null && restored.etag !== etag ? keysOf(edits as T) : [];
  return {
    base: fresh,
    etag,
    edits,
    conflicts,
    source: 'kept',
    phase: 'idle',
    fieldErrors: {},
    refusals: {},
    message: null,
  };
}

export function hasEdits(edits: object): boolean {
  return Object.keys(edits).length > 0;
}

// The state a section shows for a read: the first one, then the same one
// while neither the record nor its ETag moved, then a rebased one.
export function currentSection<T extends Values>(
  state: SectionState<T> | null,
  fresh: T,
  etag: string,
  restored: KeptDraft | null,
): SectionState<T> {
  if (state === null) return initialSection(fresh, etag, restored);
  return rebasedSection(state, fresh, etag) ?? state;
}

// Null when neither the record nor its ETag moved.
export function rebasedSection<T extends Values>(
  state: SectionState<T>,
  fresh: T,
  etag: string,
): SectionState<T> | null {
  if (sameValue(fresh, state.base) && etag === state.etag) return null;
  const rebased = rebase({ base: state.base, edits: state.edits }, fresh);
  const still = state.conflicts.filter((name) => Object.hasOwn(rebased.draft.edits, name));
  return {
    ...state,
    base: fresh,
    etag,
    edits: rebased.draft.edits,
    conflicts: uniqueIds([...still, ...rebased.conflicts]),
    source: rebased.conflicts.length > 0 ? 'changed' : state.source,
    phase: state.phase === 'unread' && etag !== state.etag ? 'stale' : state.phase,
  };
}

export function editedSection<T extends Values, K extends keyof T & string>(
  state: SectionState<T>,
  field: K,
  value: T[K],
): SectionState<T> {
  return {
    ...state,
    edits: editDraft({ base: state.base, edits: state.edits }, field, value).edits,
    fieldErrors: Object.fromEntries(
      Object.entries(state.fieldErrors).filter(([name]) => name !== field),
    ),
    refusals: Object.fromEntries(Object.entries(state.refusals).filter(([name]) => name !== field)),
    phase: state.phase === 'saving' ? 'saving' : 'idle',
    message: null,
  };
}

export function savingSection<T extends Values>(state: SectionState<T>): SectionState<T> {
  return { ...state, phase: 'saving', message: null };
}

export function mineKept<T extends Values>(state: SectionState<T>): SectionState<T> {
  return { ...state, conflicts: [] };
}

export function theirsTaken<T extends Values>(state: SectionState<T>): SectionState<T> {
  return {
    ...state,
    edits: withoutFields(state.edits, state.conflicts),
    conflicts: [],
    phase: 'idle',
    message: null,
  };
}

export function discardedSection<T extends Values>(state: SectionState<T>): SectionState<T> {
  return {
    ...state,
    edits: {},
    conflicts: [],
    phase: 'idle',
    fieldErrors: {},
    refusals: {},
    message: null,
  };
}

// Edits made while the save was in flight are still unsaved.
export function unsavedAfter<T extends Values>(edits: Partial<T>, sent: Partial<T>): Partial<T> {
  return Object.fromEntries(
    Object.entries(edits).filter(([name, value]) => !sameValue(value, sent[name])),
  ) as Partial<T>;
}

export function startable<T extends Values>(state: SectionState<T>, gone: boolean): boolean {
  return !gone && state.phase !== 'unread' && hasEdits(state.edits);
}

// `inFlight` is the hook's own ref, since it is not state.
export function canStart<T extends Values>(
  state: SectionState<T>,
  gone: boolean,
  inFlight: boolean,
): boolean {
  return !inFlight && startable(state, gone);
}

export function canSubmit<T extends Values>(
  state: SectionState<T>,
  gone: boolean,
  inFlight: boolean,
): boolean {
  return state.conflicts.length === 0 && canStart(state, gone, inFlight);
}

export function canKeepMine<T extends Values>(
  state: SectionState<T>,
  gone: boolean,
  inFlight: boolean,
): boolean {
  return state.conflicts.length > 0 && canStart(state, gone, inFlight);
}

export function canTakeTheirs<T extends Values>(
  state: SectionState<T>,
  inFlight: boolean,
): boolean {
  return !inFlight && state.conflicts.length > 0;
}

// Taking theirs left nothing of the section's own to save or keep.
export function settlesAfter<T extends Values>(state: SectionState<T>): boolean {
  return !hasEdits(state.edits);
}

export function valuesOf<T extends Values>(state: SectionState<T>): T {
  return { ...state.base, ...state.edits };
}

export function changedFields<T extends Values>(state: SectionState<T>): (keyof T & string)[] {
  return keysOf(state.edits as T);
}

export function statusOf<T extends Values>(state: SectionState<T>): SaveStatus {
  return state.conflicts.length > 0 ? 'conflict' : state.phase;
}

export function isSaving<T extends Values>(state: SectionState<T>): boolean {
  return state.phase === 'saving';
}

// Edits kept across a sign-in that are still unsaved.
export function restoredShown<T extends Values>(
  restored: KeptDraft | null,
  state: SectionState<T>,
): boolean {
  return restored !== null && hasEdits(state.edits);
}

export function sectionBlocked(
  gone: boolean,
  conflicts: number,
  phase: SavePhase,
): string | undefined {
  if (gone) return BLOCKED_GONE;
  if (conflicts > 0) return BLOCKED_BY_CONFLICT;
  return phase === 'unread' ? BLOCKED_UNREAD : undefined;
}

export function conflictsOf<T extends Values>(
  state: SectionState<T>,
  fields: SectionFields<T>,
): Conflict[] {
  return state.conflicts.map((name) => ({
    field: name,
    label: fields[name].label,
    theirs: state.base[name],
    yours: state.edits[name],
    secret: fields[name].kind === 'secret',
    describe: fields[name].describe,
  }));
}
