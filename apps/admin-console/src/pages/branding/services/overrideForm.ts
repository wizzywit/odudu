import { isEmptyRecord } from '#/shared/lib/services/fieldErrors';
import type { MessageOverride } from '#/pages/branding/types/messageOverride';
import {
  MESSAGE_OVERRIDE_KEY_MAX_LENGTH,
  MESSAGE_OVERRIDE_LIMIT,
  MESSAGE_OVERRIDE_MAX_LENGTH,
} from '@odudu/contracts/admin';

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

const KEY_REQUIRED = 'Enter the key of the message to override.';

const MESSAGE_REQUIRED = 'Enter the text to show instead.';

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
  return !isEmptyRecord(errors);
}
