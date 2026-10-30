import {
  MESSAGE_OVERRIDE_KEY_MAX_LENGTH,
  MESSAGE_OVERRIDE_LIMIT,
  MESSAGE_OVERRIDE_MAX_LENGTH,
  type FieldError,
  type MessageOverride,
} from '@odudu/contracts/admin';
import { writeRefusal } from '#/shared/service/capabilities';
import {
  problemSubtype,
  removalOutcome,
  writeFailureText,
  type RemovalOutcome,
} from '#/shared/service/failure';
import { fieldErrorsOf } from '#/shared/service/fieldErrors';
import { counted } from '#/shared/service/format';
import type { GatewayFailure, GatewayResult, Problem } from '#/shared/service/result';

export const OVERRIDES_TITLE = 'Message overrides';

export const OVERRIDES_DESCRIPTION =
  'The tenant’s own wording for the messages its pages and its mail show, per language. A language with no override shows the catalogue’s text. A client has no wording of its own.';

export const OVERRIDE_CAP = MESSAGE_OVERRIDE_LIMIT;

export const OVERRIDE_KEY_LENGTH = MESSAGE_OVERRIDE_KEY_MAX_LENGTH;

export const OVERRIDE_LENGTH = MESSAGE_OVERRIDE_MAX_LENGTH;

export const KEY_LABEL = 'Message key';

export const KEY_NOTE =
  'The key of the page or mail message to replace, such as login.title or reset.subject. Choose one from the list, with its English text beside it, or type it; a key the server does not know is refused.';

export const MESSAGE_LABEL = 'Text shown instead';

export const OVERRIDE_MESSAGE_NOTE =
  'Keep placeholders such as {name} as the catalogue writes them. Markup is shown as text.';

export const OVERRIDE_LOCALE_LABEL = 'Language';

export const SAVE_OVERRIDE = 'Save override';

export const EDIT_HINT = 'Editing an override replaces its text.';

export const NOTHING_YET = 'No message has been overridden in this language.';

export const NOUN = { one: 'override', other: 'overrides' } as const;

// What the console says in place of the server's field messages: the server
// names a path, the console says what to do about it.
export const UNKNOWN_KEY =
  'That is not the key of any page or mail message. Keys look like login.title, and the catalogue is in English.';

export const OVER_BOUND = `The tenant already has ${String(OVERRIDE_CAP)} message overrides, the most it may hold. Remove one first; changing an override that exists is always allowed.`;

export const KEY_REQUIRED = 'Enter the key of the message to override.';

export const MESSAGE_REQUIRED = 'Enter the text to show instead.';

// What the form holds. `etag` is the version of the override the form was
// filled from, or null for one typed from nothing, which is a create.
export interface OverrideValues {
  key: string;
  message: string;
  etag: string | null;
}

export type OverrideField = 'key' | 'message';

export type OverrideErrors = Partial<Record<OverrideField, string>>;

export const EMPTY_OVERRIDE: OverrideValues = { key: '', message: '', etag: null };

// Typing another key leaves behind the version of the one first chosen.
export function editedOverride(
  values: OverrideValues,
  field: OverrideField,
  value: string,
): OverrideValues {
  return { ...values, [field]: value, etag: field === 'key' ? null : values.etag };
}

export function filledOverride(
  row: Pick<MessageOverride, 'key' | 'message' | 'etag'>,
): OverrideValues {
  return { key: row.key, message: row.message, etag: row.etag };
}

export function overrideProblems(values: OverrideValues): OverrideErrors {
  const key = values.key.trim();
  return {
    ...(key === '' ? { key: KEY_REQUIRED } : {}),
    ...(key.length > OVERRIDE_KEY_LENGTH
      ? { key: `A key is at most ${String(OVERRIDE_KEY_LENGTH)} characters.` }
      : {}),
    ...(values.message === '' ? { message: MESSAGE_REQUIRED } : {}),
    ...(values.message.length > OVERRIDE_LENGTH
      ? { message: `The text is at most ${String(OVERRIDE_LENGTH)} characters.` }
      : {}),
  };
}

export function hasProblems(errors: OverrideErrors): boolean {
  return Object.keys(errors).length > 0;
}

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

export const REMOVED_TEXT =
  'The override was removed. The page or mail shows the catalogue’s text again.';

export const STALE_REMOVAL =
  'That override changed after you saw it, so it was not removed. The list is read again: look at its text now, then remove it if you still want to.';

export const ALREADY_REMOVED = 'That override is already gone. The list is read again.';

export function removeConsequence(override: Pick<MessageOverride, 'locale' | 'key'>): string {
  return `Pages and mail in ${override.locale} show the catalogue’s text for ${override.key} again. Other languages are not affected.`;
}

export function askedRemoval(asked: Pick<MessageOverride, 'locale' | 'key'> | null): string {
  return asked === null ? '' : removeConsequence(asked);
}

export function removeOutcome(result: GatewayResult<unknown>): RemovalOutcome {
  return removalOutcome(
    result,
    { doneText: REMOVED_TEXT, alreadyGoneText: ALREADY_REMOVED },
    {
      name: 'The override',
      verb: 'removed',
      lookAt: 'the list',
      stale: STALE_REMOVAL,
      refused: (problem) => writeRefusal(problem, 'manage-tenant'),
    },
  );
}

// How many are shown, said as a total only once no page is left to load.
export function capText(loaded: number, more: boolean): string {
  const shown = counted(loaded, 'override', 'overrides');
  const held = `The tenant may hold ${String(OVERRIDE_CAP)} across every language.`;
  return more
    ? `${shown} loaded so far; more follow. ${held}`
    : `${shown} in this language. ${held}`;
}

// The page size of the table; the server pages at most 200.
export const PAGE_SIZE = 50;

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

// The language the table shows: the one picked while it is still offered.
export function shownLocale(
  picked: string | null,
  supported: readonly string[],
  opening: string,
): string {
  return picked !== null && supported.includes(picked) ? picked : opening;
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

// What to do with the answer to a save: the form, the toast and the refusal.
export function afterSave(
  result: GatewayResult<unknown>,
  sent: { locale: string; key: string },
  values: OverrideValues,
): AfterSave {
  const outcome = saveOutcome(result, sent, values);
  return { ...outcome, reported: outcome.report && !result.ok ? result : null };
}
