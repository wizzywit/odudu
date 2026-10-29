import {
  INSERT_LABEL,
  INSERT_NOTE,
  KEY_FAILED,
  KEY_LIST_LIMIT,
  KEY_LOADING,
  messageOptions,
  templateReference,
  type MessageEntry,
} from '#/features/branding/service';
import { InsertPicker, OptionPicker } from '#/features/branding/view/OptionPicker';
import { mapRead, type Read } from '#/shared/service/read';

const WORDING = { loading: KEY_LOADING, failed: KEY_FAILED };

// A message key chosen from the catalogue's list, at most KEY_LIST_LIMIT
// drawn at a time and narrowed by typing part of a key or of its text.
export function MessageKeyField({
  keys,
  label,
  description,
  value,
  onChange,
  error,
  mono,
  custom,
}: {
  keys: Read<MessageEntry[]>;
  label: string;
  description: string;
  value: string;
  onChange: (key: string) => void;
  error?: string | undefined;
  mono?: boolean;
  // Whether text that names no listed key is kept: yes for an override's key,
  // which the server checks; no for a picker that only inserts.
  custom?: boolean;
}) {
  return (
    <OptionPicker
      options={mapRead(keys, messageOptions)}
      wording={WORDING}
      limit={KEY_LIST_LIMIT}
      label={label}
      description={description}
      value={value}
      onChange={onChange}
      {...(error === undefined ? {} : { error })}
      {...(mono === undefined ? {} : { mono })}
      {...(custom === undefined ? {} : { custom })}
    />
  );
}

// The picker above a template editor: chooses a message and types a reference
// to it at the caret.
export function InsertMessage({ keys }: { keys: Read<MessageEntry[]> }) {
  return (
    <InsertPicker
      options={mapRead(keys, messageOptions)}
      wording={WORDING}
      limit={KEY_LIST_LIMIT}
      label={INSERT_LABEL}
      description={INSERT_NOTE}
      text={templateReference}
    />
  );
}
