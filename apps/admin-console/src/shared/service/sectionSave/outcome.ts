import { type Values } from '#/shared/service/dirty.ts';
import { fieldErrorsOf } from '#/shared/service/fieldErrors.ts';
import { writeFailureText } from '#/shared/service/failure.ts';
import type { GatewayFailure, GatewayResult, Problem } from '#/shared/service/result.ts';
import { type SavePhase, type SectionState } from '#/shared/service/sectionSave/state.ts';
import { unsavedAfter } from '#/shared/service/sectionSave/transitions.ts';

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
