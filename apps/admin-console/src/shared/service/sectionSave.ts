import type { Conflict } from '#/shared/service/conflict.ts';
import { edit as editDraft, rebase, sameValue, type Values } from '#/shared/service/dirty.ts';
import type { KeptDraft } from '#/shared/service/drafts.ts';
import { fieldErrorsOf } from '#/shared/service/fieldErrors.ts';
import { writeFailureText } from '#/shared/service/failure.ts';
import type { GatewayFailure, GatewayResult, Problem } from '#/shared/service/result.ts';

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

function keysOf<T extends Values>(values: T): (keyof T & string)[] {
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
    message: null,
  };
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
    conflicts: [...new Set([...still, ...rebased.conflicts])],
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
  return { ...state, edits: {}, conflicts: [], phase: 'idle', fieldErrors: {}, message: null };
}

// Edits made while the save was in flight are still unsaved.
export function unsavedAfter<T extends Values>(edits: Partial<T>, sent: Partial<T>): Partial<T> {
  return Object.fromEntries(
    Object.entries(edits).filter(([name, value]) => !sameValue(value, sent[name])),
  ) as Partial<T>;
}

// `inFlight` is the hook's own ref, since it is not state.
export function startable<T extends Values>(state: SectionState<T>, gone: boolean): boolean {
  return !gone && state.phase !== 'unread' && Object.keys(state.edits).length > 0;
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

export function saveFailureText(label: string, failure: GatewayFailure): string {
  switch (failure.kind) {
    case 'network':
      return `Could not confirm that ${label} was saved. Your changes are still here, and saving again is safe.`;
    case 'schema':
      return `${label} may have been saved, but its answer could not be read. Reload to check.`;
    case 'defect':
      return `The console could not save ${label}. This is a fault in the console, not something you did.`;
    case 'problem':
      return writeFailureText(failure, {
        name: label,
        verb: 'saved',
        lookAt: '',
        missing: `${label} was not saved: it no longer exists.`,
      });
  }
}

export interface SaveOutcome {
  phase: SavePhase;
  fieldErrors?: Readonly<Record<string, string>>;
  message?: string;
  toast?: { tone: 'success' | 'error'; message: string };
  // The record is read again before anything else, after a 412.
  refetch: boolean;
  // A 403: whoami may have changed.
  refused: boolean;
}

// A 412 whose re-read failed leaves nothing to save over.
export function rereadPhase(readFailed: boolean): 'unread' | 'stale' {
  return readFailed ? 'unread' : 'stale';
}

export function saveOutcome(
  result: GatewayResult<unknown>,
  context: {
    label: string;
    capability: string;
    fields: readonly string[];
    explain?: ((problem: Problem) => string | null) | undefined;
  },
): SaveOutcome {
  const { label } = context;
  const base = { refetch: false, refused: false };
  if (result.ok) {
    return {
      ...base,
      phase: 'saved',
      fieldErrors: {},
      toast: { tone: 'success', message: `${label} saved` },
    };
  }
  if (result.kind !== 'problem') {
    return {
      ...base,
      phase: 'failed',
      toast: { tone: 'error', message: saveFailureText(label, result) },
    };
  }
  const { problem } = result;
  switch (problem.status) {
    case 412:
      return { ...base, phase: 'stale', refetch: true };
    case 401:
      return { ...base, phase: 'idle' };
    case 400: {
      const placed = fieldErrorsOf(problem, context.fields);
      return {
        ...base,
        phase: 'invalid',
        fieldErrors: placed.fields,
        ...(placed.other.length > 0
          ? {
              toast: {
                tone: 'error' as const,
                message: `${label} was not saved: ${placed.other.join('; ')}`,
              },
            }
          : {}),
      };
    }
    case 409:
      return {
        ...base,
        phase: 'refused',
        message: context.explain?.(problem) ?? problem.detail ?? problem.title,
      };
    case 403:
      return {
        ...base,
        phase: 'refused',
        refused: true,
        message:
          context.explain?.(problem) ??
          `${label} was not saved: it needs the ${context.capability} capability.`,
      };
    default:
      return {
        ...base,
        phase: 'failed',
        toast: { tone: 'error', message: saveFailureText(label, result) },
      };
  }
}

// Folds an outcome into the state. The ETag and the record itself are the
// hook's, since a saved answer replaces the cached record.
export function afterSave<T extends Values>(
  state: SectionState<T>,
  outcome: SaveOutcome,
  sent: Partial<T>,
): SectionState<T> {
  return {
    ...state,
    phase: outcome.phase,
    ...(outcome.phase === 'saved' ? { edits: unsavedAfter(state.edits, sent) } : {}),
    ...(outcome.fieldErrors === undefined ? {} : { fieldErrors: outcome.fieldErrors }),
    ...(outcome.message === undefined ? {} : { message: outcome.message }),
  };
}
