import type { MessageKeys } from '#/features/branding-editor/services/catalogue';
import { InsertPicker, OptionPicker } from '#/features/branding-editor/ui/OptionPicker';

// A message key chosen from the catalogue's list, at most `keys.limit`
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
  keys: MessageKeys;
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
      options={keys.options}
      wording={keys.wording}
      limit={keys.limit}
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
export function InsertMessage({ keys }: { keys: MessageKeys }) {
  return (
    <InsertPicker
      options={keys.options}
      wording={keys.wording}
      limit={keys.limit}
      label={keys.insert.label}
      description={keys.insert.description}
      text={keys.insert.text}
    />
  );
}
