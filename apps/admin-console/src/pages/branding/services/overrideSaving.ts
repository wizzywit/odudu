import type { FieldError } from '@odudu/contracts/admin';
import { writeRefusal } from '#/shared/services/capabilities';
import { problemSubtype, writeFailureText } from '#/shared/services/failure';
import { fieldErrorsOf } from '#/shared/services/fieldErrors';
import type { GatewayFailure, GatewayResult, Problem } from '#/shared/services/result';
import {
  type OverrideErrors,
  OVER_BOUND,
  UNKNOWN_KEY,
  type OverrideValues,
  EMPTY_OVERRIDE,
  overrideProblems,
  hasProblems,
} from '#/pages/branding/services/overrideForm';

function unknownKey(errors: readonly FieldError[] | undefined): boolean {
  return errors?.some((error) => error.path === 'key') === true;
}

export interface OverrideOutcome {
  errors: OverrideErrors;
  message: string | null;
  // Somebody else changed, created or removed the override since this form
  // was filled: the server answered 412.
  stale: boolean;
  // A refusal for lack of a capability: whoami may have changed.
  report: boolean;
}

const NO_OUTCOME: OverrideOutcome = { errors: {}, message: null, stale: false, report: false };

function problemOutcome(problem: Problem): OverrideOutcome {
  if (problem.status === 412) return { ...NO_OUTCOME, stale: true };
  if (problem.status === 409 && problemSubtype(problem) === 'message-overrides-full') {
    return { ...NO_OUTCOME, message: OVER_BOUND };
  }
  if (problem.status === 400 && unknownKey(problem.errors)) {
    return { ...NO_OUTCOME, errors: { key: UNKNOWN_KEY } };
  }
  const refused = writeRefusal(problem, 'manage-tenant');
  if (refused !== null) return { ...NO_OUTCOME, message: refused, report: true };
  const placed = fieldErrorsOf(problem, ['message']);
  return {
    ...NO_OUTCOME,
    errors: placed.fields,
    message: placed.other.length === 0 ? null : placed.other.join(' '),
  };
}

// What a failed write of an override says, placed on the field it concerns.
export function overrideFailure(failure: GatewayFailure): OverrideOutcome {
  if (failure.kind === 'problem') return problemOutcome(failure.problem);
  return {
    ...NO_OUTCOME,
    message: writeFailureText(failure, {
      name: 'The override',
      verb: 'saved',
      lookAt: 'the list',
    }),
  };
}

export function savedText(locale: string, key: string): string {
  return `The ${locale} text for ${key} was saved.`;
}

export interface SaveOutcome {
  errors: OverrideErrors;
  message: string | null;
  stale: boolean;
  report: boolean;
  // What the form holds afterwards: empty once saved, as it was otherwise.
  values: OverrideValues;
  toast: string | null;
}

export function saveOutcome(
  result: GatewayResult<unknown>,
  sent: { locale: string; key: string },
  values: OverrideValues,
): SaveOutcome {
  if (result.ok) {
    return {
      ...NO_OUTCOME,
      values: EMPTY_OVERRIDE,
      toast: savedText(sent.locale, sent.key),
    };
  }
  return { ...overrideFailure(result), values, toast: null };
}

export interface OverrideAttempt {
  errors: OverrideErrors;
  // What is sent, or null while the form has problems.
  sent: SentOverride | null;
}

export interface SentOverride {
  locale: string;
  key: string;
  message: string;
  etag: string | null;
}

// The form as it is sent: the key trimmed, or the problems that hold it back.
export function overrideAttempt(locale: string, values: OverrideValues): OverrideAttempt {
  const errors = overrideProblems(values);
  return {
    errors,
    sent: hasProblems(errors)
      ? null
      : { locale, key: values.key.trim(), message: values.message, etag: values.etag },
  };
}

export interface AfterSave extends SaveOutcome {
  // The refusal to report to whoami, when the answer was a refusal.
  reported: GatewayFailure | null;
}

export type SaveStep =
  { kind: 'toast'; text: string } | { kind: 'report'; failure: GatewayFailure };

// The things an answer to a save asks to be done beyond the form, in order.
export function settle(after: AfterSave): SaveStep[] {
  const steps: SaveStep[] = [];
  if (after.toast !== null) steps.push({ kind: 'toast', text: after.toast });
  if (after.reported !== null) steps.push({ kind: 'report', failure: after.reported });
  return steps;
}

// What to do with the answer to a save: the form, the toast and the refusal.
export function afterSave(
  result: GatewayResult<unknown>,
  sent: { locale: string; key: string },
  values: OverrideValues,
): AfterSave {
  const outcome = saveOutcome(result, sent, values);
  return { ...outcome, reported: outcome.report && !result.ok ? result : null };
}
